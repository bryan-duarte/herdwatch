/** @typedef {import("./schemas.js").MonitorState} MonitorState */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */
/** @typedef {import("./schemas.js").SnapshotResult} SnapshotResult */

export const SNAPSHOT_FORMAT_VERSION = 2;
const HOST_STATES = new Set(["ok", "down", "auth", "pending"]);
const WORKTREE_STATES = new Set(["ok", "failed", "pending"]);
const SETTING_KEYS = ["warn", "crit", "top_n", "ssh_timeout", "pane_refresh", "stale_seconds", "worktree_interval", "worktree_timeout"];
const HOST_LISTS = ["processes", "agents", "ports", "cores"];

/** @param {unknown} candidate @returns {candidate is Record<string, any>} */
export const isRecord = (candidate) => candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);

/** @param {unknown} worktrees */
export const isHostWorktrees = (worktrees) => isRecord(worktrees) && WORKTREE_STATES.has(worktrees.state) && Array.isArray(worktrees.items);

/** @param {unknown} host @param {number} index */
function hostError(host, index) {
  if (!isRecord(host)) return `host ${index} is not an object`;
  if (typeof host.label !== "string") return `host ${index} has no label`;
  if (!HOST_STATES.has(host.state)) return `host ${host.label} has an unknown state`;
  const missingList = HOST_LISTS.find((key) => !Array.isArray(host[key]));
  if (missingList) return `host ${host.label} has no ${missingList} list`;
  if (!isHostWorktrees(host.worktrees)) return `host ${host.label} has no worktree data`;
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
  if (!Array.isArray(snapshot.hosts) || !Array.isArray(snapshot.alerts)) return "snapshot lists are missing";
  return settingsError(snapshot.settings) ?? snapshot.hosts.map(hostError).find(Boolean) ?? null;
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
    return { ok: false, error: `snapshot is not JSON: ${String(parseError)}` };
  }
  if (!isRecord(parsed)) return { ok: false, error: "snapshot is not an object" };
  const error = snapshotError(parsed);
  return error ? { ok: false, error } : { ok: true, snapshot: /** @type {Snapshot} */ (parsed) };
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
    error: typeof stored.error === "string" ? stored.error : null,
  };
}
