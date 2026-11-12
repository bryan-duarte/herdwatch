import { SNAPSHOT_TIMEOUT_MS } from "./backend.js";
import { age, hostNameOfTarget, nowInSeconds } from "./format.js";

/** @typedef {import("./schemas.js").BackendFailure} BackendFailure */
/** @typedef {import("./schemas.js").BackendFailureReason} BackendFailureReason */
/** @typedef {import("./schemas.js").ConfigProblem} ConfigProblem */
/** @typedef {import("./schemas.js").ConfigProblemReason} ConfigProblemReason */
/** @typedef {import("./schemas.js").FailureReason} FailureReason */
/** @typedef {import("./schemas.js").Guidance} Guidance */
/** @typedef {import("./schemas.js").HostDocker} HostDocker */
/** @typedef {import("./schemas.js").HostProblem} HostProblem */
/** @typedef {import("./schemas.js").HostProblemReason} HostProblemReason */
/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").HostWorktrees} HostWorktrees */
/** @typedef {import("./schemas.js").MonitorSettings} MonitorSettings */

/**
 * @typedef {object} HostContext
 * @property {string} label
 * @property {string} target
 * @property {string} hostName  the target without user, scheme and port
 * @property {MonitorSettings} settings
 */

const MILLISECONDS_PER_SECOND = 1000;
const LOG_FILE = "~/.local/state/herdwatch/herdwatch.log";
/** @type {Record<string, keyof MonitorSettings>} */
const SETTING_FIELDS = {
  WARN: "warn",
  CRIT: "crit",
  TOP_N: "top_n",
  SSH_TIMEOUT: "ssh_timeout",
  PANE_REFRESH: "pane_refresh",
  STALE_SECONDS: "stale_seconds",
  WORKTREE_INTERVAL: "worktree_interval",
  WORKTREE_TIMEOUT: "worktree_timeout",
  DOCKER_INTERVAL: "docker_interval",
  ALERTS: "alerts",
  DOCKER: "docker",
};

/** @type {Record<FailureReason, (host: HostContext) => Guidance>} */
export const FAILURE_GUIDANCE = {
  timeout: ({ label, settings }) => ({
    summary: `${label} did not answer within SSH_TIMEOUT (${settings.ssh_timeout} s).`,
    nextStep: "Raise SSH_TIMEOUT in settings.conf, or check the network.",
  }),
  hostkey: ({ label, target, hostName }) => ({
    summary: `The host key of ${label} changed since the last login.`,
    nextStep: `If you expected this, run ssh-keygen -R ${hostName}, then ssh ${target} once.`,
  }),
  tailscale_check: ({ label, target }) => ({
    summary: `Tailscale SSH asks for a browser check before it lets Herdwatch into ${label}.`,
    nextStep: `Run ssh ${target} in a terminal and finish the check.`,
  }),
  login: ({ label, target }) => ({
    summary: `${label} refused the SSH login.`,
    nextStep: `Herdwatch needs a key login without a prompt. Run ssh ${target} once and fix the key.`,
  }),
  dns: ({ label, hostName }) => ({
    summary: `The name ${hostName} does not resolve.`,
    nextStep: `Check the target of ${label} in hosts.conf.`,
  }),
  refused: ({ label }) => ({
    summary: `${label} refused the connection on the SSH port.`,
    nextStep: `Start sshd on ${label}, or check the port in hosts.conf.`,
  }),
  unreachable: ({ label }) => ({
    summary: `There is no network route to ${label}.`,
    nextStep: "Check the VPN or the network. Herdwatch tries again at the next poll.",
  }),
  ssh_config: ({ target }) => ({
    summary: "Your SSH config has an error.",
    nextStep: `Run ssh -G ${target} to find the bad line in ~/.ssh/config.`,
  }),
  remote_shell: ({ label }) => ({
    summary: `${label} answered, but its login shell cannot run sh.`,
    nextStep: "Give the SSH user a normal login shell.",
  }),
  probe_format: ({ label }) => ({
    summary: `${label} answered with text that is not Herdwatch data.`,
    nextStep: "Remove the lines that print text from the login files of the SSH user (.bashrc, .profile).",
  }),
  parse_failed: ({ label }) => ({
    summary: `Herdwatch could not read the data from ${label}.`,
    nextStep: `This is a Herdwatch bug. Report the line from ${LOG_FILE}.`,
  }),
  unknown: ({ label, target }) => ({
    summary: `${label} did not answer.`,
    nextStep: `Run ssh ${target} true in a terminal to see the error.`,
  }),
};

/** @type {Record<HostProblemReason, (problem: HostProblem) => Guidance>} */
export const HOST_PROBLEM_GUIDANCE = {
  ports_hidden: ({ detail }) => ({ summary: `Ports are hidden: ${detail} is not installed.`, nextStep: `Install ${detail} on the host.` }),
  missing_tools: ({ detail }) => ({ summary: `Some data is missing: ${detail} is not installed.`, nextStep: `Install ${detail} on the host.` }),
  unsupported_os: () => ({ summary: "Herdwatch does not know the OS of this host.", nextStep: "Herdwatch reads Linux and macOS hosts." }),
};

/** @type {Record<BackendFailureReason, () => Guidance>} */
export const BACKEND_GUIDANCE = {
  backend_timeout: () => ({
    summary: `The poll took longer than ${SNAPSHOT_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s.`,
    nextStep: "Lower SSH_TIMEOUT in settings.conf, or remove slow hosts from hosts.conf.",
  }),
  backend_missing: () => ({
    summary: "The Herdwatch backend is missing.",
    nextStep: "Copy the whole mods/herdwatch folder into ~/.config/herdr-app/mods/ again.",
  }),
  bad_output: () => ({
    summary: "The backend printed data that the console cannot read.",
    nextStep: "Copy the whole mods/herdwatch folder again, so the backend and the console match.",
  }),
  mod_bug: () => ({ summary: "The backend stopped with an error.", nextStep: `Read ${LOG_FILE}, and report the error.` }),
  runtime_dir: () => ({
    summary: "Herdwatch cannot use its folders.",
    nextStep: "Make sure that you own /tmp/herdwatch-<your uid> and ~/.local/state/herdwatch.",
  }),
};

/** @type {Record<ConfigProblemReason, (problem: ConfigProblem) => string>} */
const CONFIG_PROBLEM_TEXT = {
  not_a_positive_integer: ({ key, value }) => `${key}=${value} is not a positive number`,
  above_100: ({ key, value }) => `${key}=${value} is above 100`,
  above_crit: ({ value }) => `WARN=${value} is above CRIT`,
  bad_regex: ({ key }) => `${key} is not a valid regular expression`,
  bad_path_list: ({ key, value }) => `${key}=${value} is not a list of 1 to 8 folders`,
  bad_branch_list: ({ key, value }) => `${key}=${value} is not a list of 1 to 8 branch names`,
  not_on_or_off: ({ key, value }) => `${key}=${value} is not on or off`,
  unknown_key: ({ key }) => `${key} is not a setting`,
  bad_label: ({ key }) => `the label ${key} is not valid. Use letters, digits, ".", "_" or "-", at most 24 characters`,
  bad_target: ({ key }) => `the target of ${key} is empty or starts with "-"`,
  duplicate: ({ key }) => `the label ${key} is used twice`,
  unreadable: () => "Herdwatch cannot read this file",
  bad_port: ({ value }) => `${value} is not a port from 1 to 65535`,
  unknown_host: ({ key }) => `${key} is not a host in hosts.conf`,
  broken_host: ({ key, value }) => `the data of host ${key} is broken: ${value}`,
};

/** @param {HostSnapshot} host @param {MonitorSettings} settings @returns {HostContext} */
const hostContext = (host, settings) => ({ label: host.label, target: host.target, hostName: hostNameOfTarget(host.target), settings });

/**
 * Why a host does not answer, and what to do. A host without a reason (an older record) gets the general advice.
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 * @returns {Guidance}
 */
export function hostFailureGuidance(host, settings) {
  const fallbackReason = host.state === "auth" ? "login" : "unknown";
  const reason = host.reason && Object.hasOwn(FAILURE_GUIDANCE, host.reason) ? host.reason : fallbackReason;
  return FAILURE_GUIDANCE[reason](hostContext(host, settings));
}

/** @param {HostProblem} problem @returns {Guidance} */
export const hostProblemGuidance = (problem) => HOST_PROBLEM_GUIDANCE[problem.reason](problem);

/** @param {BackendFailure} failure @returns {Guidance} */
export const backendGuidance = (failure) => BACKEND_GUIDANCE[failure.reason]();

/** @param {ConfigProblem} problem @param {MonitorSettings} settings */
function configProblemOutcome(problem, settings) {
  if (problem.file === "hosts.conf") return "Herdwatch skips this line.";
  if (problem.file === "pins.conf") return "Herdwatch skips this pin.";
  if (problem.file === "snapshot") return "Herdwatch hides this host.";
  const settingKey = problem.reason === "above_crit" ? "CRIT" : problem.key;
  const field = SETTING_FIELDS[settingKey];
  if (!field) return "Herdwatch uses the default.";
  const currentValue = settings[field];
  return `Herdwatch uses ${typeof currentValue === "boolean" ? (currentValue ? "on" : "off") : currentValue}.`;
}

/**
 * "settings.conf line 4: SSH_TIMEOUT=0 is not a positive number. Herdwatch uses 3."
 * @param {ConfigProblem} problem
 * @param {MonitorSettings} settings
 */
export function configProblemLine(problem, settings) {
  const place = Number.isFinite(problem.line) ? `${problem.file} line ${problem.line}` : problem.file;
  const describeProblem = CONFIG_PROBLEM_TEXT[problem.reason] ?? (() => `${problem.key} was refused (${problem.reason})`);
  return `${place}: ${describeProblem(problem)}. ${configProblemOutcome(problem, settings)}`;
}

/**
 * Why the last worktree or Docker measure of a host failed, or what it could not find.
 * @param {"worktree" | "Docker"} measureName
 * @param {HostWorktrees | HostDocker} measure
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 * @returns {Guidance}
 */
export function measureGuidance(measureName, measure, host, settings) {
  if (measure.reason === "missing_root") {
    return { summary: `These WORKTREE_ROOTS are not on ${host.label}: ${measure.error}.`, nextStep: "Fix WORKTREE_ROOTS in settings.conf." };
  }
  if (measure.reason === "timeout") {
    const nextStep = measureName === "worktree"
      ? "Raise WORKTREE_TIMEOUT, or lower WORKTREE_DEPTH, in settings.conf."
      : "Check that docker system df answers on the host.";
    return { summary: `The ${measureName} measure of ${host.label} took too long.`, nextStep };
  }
  if (measure.reason) return FAILURE_GUIDANCE[measure.reason](hostContext(host, settings));
  return { summary: `The ${measureName} measure of ${host.label} failed.`, nextStep: "Herdwatch tries again at the next measure." };
}

/**
 * " · down for 12m", or "" when the record has no down_since.
 * @param {HostSnapshot} host
 * @param {number} now
 */
export const downForText = (host, now = nowInSeconds()) =>
  (Number.isFinite(host.down_since) ? ` · down for ${age(Math.max(0, now - host.down_since))}` : "");

/**
 * "Show kali (1) · ssh 42 ms", or "Show kali (1) · down for 12m · <why>".
 * @param {HostSnapshot} host
 * @param {number} index
 * @param {MonitorSettings} settings
 * @param {number} now
 */
export function hostTabTooltip(host, index, settings, now = nowInSeconds()) {
  const action = `Show ${host.label} (${index + 1})`;
  if (host.state === "ok") return Number.isFinite(host.rtt_ms) ? `${action} · ssh ${host.rtt_ms} ms` : action;
  if (host.state === "pending") return action;
  return `${action}${downForText(host, now)} · ${hostFailureGuidance(host, settings).summary}`;
}
