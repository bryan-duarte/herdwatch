/** @typedef {import("./types.js").SnapshotResult} SnapshotResult */
/** @typedef {import("./types.js").Snapshot} Snapshot */

export const SNAPSHOT_FORMAT_VERSION = 2;
const HOST_STATES = new Set(["ok", "down", "auth", "pending"]);
const WORKTREE_STATES = new Set(["ok", "failed", "pending"]);
const SETTING_KEYS = ["warn", "crit", "top_n", "ssh_timeout", "pane_refresh", "stale_seconds", "worktree_interval", "worktree_timeout"];
const HOST_LISTS = ["processes", "agents", "ports", "cores"];

/** @param {unknown} candidate @returns {candidate is Record<string, any>} */
const isObject = (candidate) => candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);

/** @param {unknown} host @param {number} index */
function hostError(host, index) {
  if (!isObject(host)) return `host ${index} is not an object`;
  if (typeof host.label !== "string") return `host ${index} has no label`;
  if (!HOST_STATES.has(host.state)) return `host ${host.label} has an unknown state`;
  const missingList = HOST_LISTS.find((key) => !Array.isArray(host[key]));
  if (missingList) return `host ${host.label} has no ${missingList} list`;
  if (!isObject(host.worktrees) || !WORKTREE_STATES.has(host.worktrees.state) || !Array.isArray(host.worktrees.items)) {
    return `host ${host.label} has no worktree data`;
  }
  return null;
}

/** @param {unknown} settings */
function settingsError(settings) {
  if (!isObject(settings)) return "settings are missing";
  const badKey = SETTING_KEYS.find((key) => !Number.isFinite(settings[key]));
  return badKey ? `setting ${badKey} is not a number` : null;
}

/**
 * Shared state outlives mod updates; a stored snapshot of another format version counts as no data.
 * @param {unknown} stored
 * @returns {import("./types.js").MonitorState | null}
 */
export function monitorStateOrNull(stored) {
  if (!isObject(stored)) return null;
  const snapshot = isObject(stored.snapshot) && stored.snapshot.version === SNAPSHOT_FORMAT_VERSION ? /** @type {Snapshot} */ (stored.snapshot) : null;
  return { snapshot, error: typeof stored.error === "string" ? stored.error : null };
}

/**
 * @param {unknown} stored
 * @returns {import("./types.js").WorktreesByHost}
 */
export function worktreesOrEmpty(stored) {
  if (!isObject(stored)) return {};
  const valid = Object.entries(stored).filter(([, value]) => isObject(value) && Array.isArray(value.items) && WORKTREE_STATES.has(value.state));
  return Object.fromEntries(valid);
}

/**
 * The stored poll lease names the copy that polls. Another copy may poll only when the lease is missing, broken or old.
 * @param {unknown} stored
 * @param {string} copyId
 * @param {number} now
 * @param {number} leaseSeconds
 */
export function isPollLeaseHeldByAnotherCopy(stored, copyId, now, leaseSeconds) {
  if (!isObject(stored) || typeof stored.owner !== "string" || !Number.isFinite(stored.at)) return false;
  return stored.owner !== copyId && now - stored.at < leaseSeconds;
}

/**
 * @param {string} backendOutput
 * @returns {SnapshotResult}
 */
export function parseSnapshot(backendOutput) {
  let snapshot;
  try {
    snapshot = JSON.parse(backendOutput);
  } catch (parseError) {
    return { ok: false, error: `snapshot is not JSON: ${String(parseError)}` };
  }
  if (!isObject(snapshot)) return { ok: false, error: "snapshot is not an object" };
  if (snapshot.version !== SNAPSHOT_FORMAT_VERSION) return { ok: false, error: `snapshot version ${snapshot.version} is not supported` };
  if (!Number.isFinite(snapshot.generated_at)) return { ok: false, error: "snapshot has no time" };
  if (!Array.isArray(snapshot.hosts) || !Array.isArray(snapshot.alerts)) return { ok: false, error: "snapshot lists are missing" };
  const firstError = settingsError(snapshot.settings) ?? snapshot.hosts.map(hostError).find(Boolean);
  return firstError ? { ok: false, error: firstError } : { ok: true, snapshot: /** @type {Snapshot} */ (snapshot) };
}
