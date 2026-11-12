import { appHome, exec } from "herdr";
import { MOD_NAME } from "./mod.js";
import { parseSnapshot } from "./snapshot.js";

/** @typedef {import("./schemas.js").BackendRunResult} BackendRunResult */
/** @typedef {import("./schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("./schemas.js").SnapshotResult} SnapshotResult */

const SNAPSHOT_TIMEOUT_MS = 20000;
const WORKTREE_TIMEOUT_MARGIN_MS = 30000;
const MAX_EXEC_TIMEOUT_MS = 600000;
const MILLISECONDS_PER_SECOND = 1000;

const backendPath = () => `${appHome()}/mods/${MOD_NAME}/bin/herdwatch`;

/**
 * @param {"snapshot" | "worktrees"} command
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: true, stdout: string } | { ok: false, error: string }>}
 */
async function runBackend(command, timeoutMs) {
  try {
    const run = await exec("bash", [backendPath(), command], { timeout: timeoutMs });
    if (run.code !== 0) return { ok: false, error: run.stderr.trim() || `backend exited with ${run.code}` };
    return { ok: true, stdout: run.stdout };
  } catch (execError) {
    return { ok: false, error: String(execError) };
  }
}

/**
 * Polls every host once and returns the checked snapshot.
 * @returns {Promise<SnapshotResult>}
 */
export async function runSnapshot() {
  const run = await runBackend("snapshot", SNAPSHOT_TIMEOUT_MS);
  if (run.ok === false) return run;
  return parseSnapshot(run.stdout);
}

/**
 * Measures the worktrees of every host; the next snapshot carries the new numbers.
 * @param {MonitorSettings} settings
 * @returns {Promise<BackendRunResult>}
 */
export async function measureWorktrees(settings) {
  const timeoutMs = Math.min(settings.worktree_timeout * MILLISECONDS_PER_SECOND + WORKTREE_TIMEOUT_MARGIN_MS, MAX_EXEC_TIMEOUT_MS);
  const run = await runBackend("worktrees", timeoutMs);
  if (run.ok === false) return run;
  return { ok: true };
}
