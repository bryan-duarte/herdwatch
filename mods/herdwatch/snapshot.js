/** @typedef {import("./schemas.js").BackendFailure} BackendFailure */
/** @typedef {import("./schemas.js").ConfigProblem} ConfigProblem */
/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").MonitorState} MonitorState */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */
/** @typedef {import("./schemas.js").SnapshotResult} SnapshotResult */

export const SNAPSHOT_FORMAT_VERSION = 3;
const HOST_STATES = new Set(["ok", "down", "auth", "pending"]);
const MEASURE_STATES = new Set(["ok", "failed", "pending"]);
const DOCKER_STATES = new Set(["ok", "failed", "pending", "missing", "denied", "off"]);
const BACKEND_FAILURE_REASONS = new Set(["backend_timeout", "backend_missing", "bad_output", "mod_bug", "runtime_dir"]);
const SETTING_KEYS = ["warn", "crit", "top_n", "ssh_timeout", "pane_refresh", "stale_seconds", "worktree_interval", "worktree_timeout", "docker_interval"];
const HOST_LISTS = ["processes", "agents", "ports", "cores", "problems"];
const DOCKER_LISTS = ["containers", "images", "volumes"];
const SNAPSHOT_LISTS = ["hosts", "alerts", "problems"];

/** @param {unknown} candidate @returns {candidate is Record<string, any>} */
export const isRecord = (candidate) => candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);

/** @param {unknown} worktrees */
export const isHostWorktrees = (worktrees) => isRecord(worktrees) && MEASURE_STATES.has(worktrees.state) && Array.isArray(worktrees.items);

/** @param {unknown} docker */
export const isHostDocker = (docker) => isRecord(docker) && DOCKER_STATES.has(docker.state) && DOCKER_LISTS.every((list) => Array.isArray(docker[list]));

/** @param {unknown} failure @returns {failure is BackendFailure} */
const isBackendFailure = (failure) => isRecord(failure) && BACKEND_FAILURE_REASONS.has(failure.reason) && typeof failure.detail === "string";

/** @param {unknown} host @param {number} index */
function hostError(host, index) {
  if (!isRecord(host)) return `host ${index} is not an object`;
  if (typeof host.label !== "string") return `host ${index} has no label`;
  if (!HOST_STATES.has(host.state)) return `host ${host.label} has an unknown state`;
  const missingList = HOST_LISTS.find((key) => !Array.isArray(host[key]));
  if (missingList) return `host ${host.label} has no ${missingList} list`;
  if (!isHostWorktrees(host.worktrees)) return `host ${host.label} has no worktree data`;
  if (!isHostDocker(host.docker)) return `host ${host.label} has no Docker data`;
  return null;
}

/** @param {unknown} settings */
function settingsError(settings) {
  if (!isRecord(settings)) return "settings are missing";
  const badKey = SETTING_KEYS.find((key) => !Number.isFinite(settings[key]));
  return badKey ? `setting ${badKey} is not a number` : null;
}

/** @param {Record<string, any>} snapshot */
function snapshotError(snapshot) {
  if (snapshot.version !== SNAPSHOT_FORMAT_VERSION) return `snapshot version ${snapshot.version} is not supported`;
  if (!Number.isFinite(snapshot.generated_at)) return "snapshot has no time";
  if (!SNAPSHOT_LISTS.every((list) => Array.isArray(snapshot[list]))) return "snapshot lists are missing";
  return settingsError(snapshot.settings);
}

/**
 * Keeps the good hosts. Each broken host becomes a problem that names it, so one bad host does not blank the others.
 * @param {Record<string, any>} snapshot
 * @returns {Snapshot}
 */
function withoutBrokenHosts(snapshot) {
  /** @type {HostSnapshot[]} */
  const hosts = [];
  /** @type {ConfigProblem[]} */
  const brokenHostProblems = [];
  snapshot.hosts.forEach((/** @type {unknown} */ host, /** @type {number} */ index) => {
    const brokenReason = hostError(host, index);
    if (!brokenReason) {
      hosts.push(/** @type {HostSnapshot} */ (host));
      return;
    }
    const hostName = isRecord(host) && typeof host.label === "string" ? host.label : `host ${index + 1}`;
    brokenHostProblems.push({ file: "snapshot", line: null, key: hostName, value: brokenReason, reason: "broken_host" });
  });
  return /** @type {Snapshot} */ ({ ...snapshot, hosts, problems: [...snapshot.problems, ...brokenHostProblems] });
}

/**
 * @param {string} backendOutput
 * @returns {SnapshotResult}
 */
export function parseSnapshot(backendOutput) {
  let parsed;
  try {
    parsed = JSON.parse(backendOutput);
  } catch (parseError) {
    return { ok: false, failure: { reason: "bad_output", detail: `snapshot is not JSON: ${String(parseError)}` } };
  }
  if (!isRecord(parsed)) return { ok: false, failure: { reason: "bad_output", detail: "snapshot is not an object" } };
  const error = snapshotError(parsed);
  if (error) return { ok: false, failure: { reason: "bad_output", detail: error } };
  return { ok: true, snapshot: withoutBrokenHosts(parsed) };
}

/**
 * Shared state outlives mod updates; a stored snapshot of another format version counts as no data.
 * @param {unknown} stored
 * @returns {MonitorState | null}
 */
export function monitorStateOrNull(stored) {
  if (!isRecord(stored)) return null;
  const hasCurrentSnapshot = isRecord(stored.snapshot) && stored.snapshot.version === SNAPSHOT_FORMAT_VERSION;
  return {
    snapshot: hasCurrentSnapshot ? /** @type {Snapshot} */ (stored.snapshot) : null,
    error: isBackendFailure(stored.error) ? stored.error : null,
  };
}
