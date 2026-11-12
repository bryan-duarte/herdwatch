import { exec, hc, terminals } from "herdr";

/** @typedef {import("herdr").ExecResult} ExecResult */
/** @typedef {import("./schemas.js").Tunnel} Tunnel */

/**
 * @typedef {{ ok: true, localPort: number }
 *   | { ok: false, reason: "port_busy" | "ssh_failed" | "hc_missing", message: string }} TunnelStart
 */

export const OPENING_TUNNEL_NOTE = "Opening a tunnel…";
const LABELS = { kind: "herdwatch", host: "herdwatch.host", remotePort: "herdwatch.remote_port", localPort: "herdwatch.local_port" };
const TUNNEL_KIND = "tunnel";
const FIRST_UNPRIVILEGED_PORT = 1024;
const PRIVILEGED_PORT_OFFSET = 8000;
const MAX_PORT = 65535;
const LOCAL_PORT_CANDIDATES = 20;
const TERMINAL_NAME_MAX_LENGTH = 32;
const SSH_KEEPALIVE_SECONDS = 15;
const FAILURE_OUTPUT_LINES = 20;
const READY_TIMEOUT_MS = 10000;
const PORT_ARGUMENT_NAME = "herdwatch";
const PORT_ANSWERS_SCRIPT = '(exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null';
const PORT_OPENS_SCRIPT = 'for attempt in $(seq 1 25); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exit 0; sleep 0.2; done; exit 1';
const TUNNEL_NAME_PREFIX = "hw-tunnel-";

/** @param {string} label @param {number} port */
export const portNoteKey = (label, port) => `${label}:${port}`;

/**
 * @param {Tunnel[]} tunnels
 * @param {string} label
 * @param {number} remotePort
 * @returns {Tunnel | null}
 */
export const tunnelOfPort = (tunnels, label, remotePort) =>
  tunnels.find((tunnel) => tunnel.label === label && tunnel.remotePort === remotePort) ?? null;

/**
 * Only the label part is cut to fit herdr-core's 32 characters, so two ports of one host never share a name.
 * @param {string} label
 * @param {number} remotePort
 */
export function tunnelName(label, remotePort) {
  const portSuffix = `-${remotePort}`;
  const labelRoom = TERMINAL_NAME_MAX_LENGTH - TUNNEL_NAME_PREFIX.length - portSuffix.length;
  return `${TUNNEL_NAME_PREFIX}${label.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, labelRoom)}${portSuffix}`;
}

/**
 * A failed start of hc or of a program counts as no answer; the caller decides what that means.
 * @param {() => Promise<ExecResult>} start
 * @returns {Promise<ExecResult | null>}
 */
async function resultOrNull(start) {
  try {
    return await start();
  } catch {
    return null;
  }
}

/** @param {number} port */
async function isLocalPortBusy(port) {
  const probe = await exec("bash", ["-c", PORT_ANSWERS_SCRIPT, PORT_ARGUMENT_NAME, String(port)]);
  return probe.code === 0;
}

/**
 * The same number as the remote port when it is free here, else the first free port above it.
 * A remote port below 1024 maps above 8000, because a normal user cannot listen there.
 * @param {number} remotePort
 */
async function freeLocalPort(remotePort) {
  const firstCandidate = remotePort >= FIRST_UNPRIVILEGED_PORT ? remotePort : remotePort + PRIVILEGED_PORT_OFFSET;
  for (let candidate = firstCandidate; candidate < firstCandidate + LOCAL_PORT_CANDIDATES && candidate <= MAX_PORT; candidate++) {
    if (!(await isLocalPortBusy(candidate))) return candidate;
  }
  return null;
}

/** @param {number} localPort */
async function hasLocalPortOpened(localPort) {
  const wait = await resultOrNull(() => exec("bash", ["-c", PORT_OPENS_SCRIPT, PORT_ARGUMENT_NAME, String(localPort)], { timeout: READY_TIMEOUT_MS }));
  return wait?.code === 0;
}

/** @param {string} name */
async function lastOutputLine(name) {
  const terminalOutput = await resultOrNull(() => hc(["read", name, "--lines", String(FAILURE_OUTPUT_LINES)]));
  const lines = (terminalOutput?.stdout ?? "").split("\n").map((/** @type {string} */ line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}

/** @param {string} terminal */
async function removeTerminal(terminal) {
  await resultOrNull(() => hc(["kill", terminal]));
  await resultOrNull(() => hc(["rm", terminal]));
}

/**
 * @param {string} name
 * @param {{ label: string, target: string }} host
 * @param {number} remotePort
 * @param {number} localPort
 */
function tunnelCommand(name, host, remotePort, localPort) {
  return ["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", name,
    "--label", `${LABELS.kind}=${TUNNEL_KIND}`, "--label", `${LABELS.host}=${host.label}`,
    "--label", `${LABELS.remotePort}=${remotePort}`, "--label", `${LABELS.localPort}=${localPort}`,
    "--", "ssh", "-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", `ServerAliveInterval=${SSH_KEEPALIVE_SECONDS}`,
    "-L", `127.0.0.1:${localPort}:localhost:${remotePort}`, "--", host.target];
}

/**
 * Starts "ssh -N -L" in a background herdr-core terminal and waits until the local port answers.
 * The tunnel listens on 127.0.0.1 only, so the remote server never reaches the local network.
 * @param {{ label: string, target: string }} host
 * @param {number} remotePort
 * @returns {Promise<TunnelStart>}
 */
export async function startTunnel(host, remotePort) {
  const localPort = await freeLocalPort(remotePort);
  if (!localPort) {
    return { ok: false, reason: "port_busy", message: `Local ports from ${remotePort} up are busy. Stop a program that holds one, then try again.` };
  }
  const name = tunnelName(host.label, remotePort);
  const started = await resultOrNull(() => hc(tunnelCommand(name, host, remotePort, localPort)));
  if (started?.code !== 0) {
    const hcError = started?.stderr.trim() || "no answer";
    return { ok: false, reason: "hc_missing", message: `herdr-core did not start the tunnel: ${hcError}. Update Herdr, then try again.` };
  }
  if (await hasLocalPortOpened(localPort)) return { ok: true, localPort };
  const sshError = await lastOutputLine(name);
  await removeTerminal(name);
  return { ok: false, reason: "ssh_failed", message: `ssh did not open the tunnel${sshError ? `: ${sshError}` : ""}. Check that ssh ${host.target} works in a terminal.` };
}

/** @param {unknown} labels @param {string} key */
const labelNumber = (labels, key) => Number(/** @type {Record<string, string>} */ (labels)?.[key]);

/** @returns {Tunnel[]} */
export function runningTunnels() {
  return terminals()
    .filter((terminal) => terminal?.labels?.[LABELS.kind] === TUNNEL_KIND && terminal.state === "live")
    .map((terminal) => ({
      terminal: terminal.address,
      label: String(terminal.labels[LABELS.host] ?? ""),
      remotePort: labelNumber(terminal.labels, LABELS.remotePort),
      localPort: labelNumber(terminal.labels, LABELS.localPort),
      state: "running",
    }));
}

/** @param {Tunnel} tunnel */
export const stopTunnel = (tunnel) => removeTerminal(tunnel.terminal);
