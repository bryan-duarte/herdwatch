import { appHome, exec } from "herdr";
import { MOD_NAME } from "./mod.js";
import { parseSnapshot } from "./snapshot.js";

/** @typedef {import("./schemas.js").BackendFailure} BackendFailure */
/** @typedef {import("./schemas.js").BackendRunResult} BackendRunResult */
/** @typedef {import("./schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("./schemas.js").SnapshotResult} SnapshotResult */

export const SNAPSHOT_TIMEOUT_MS = 20000;
const WORKTREE_TIMEOUT_MARGIN_MS = 30000;
const DOCKER_MEASURE_TIMEOUT_MS = 90000;
const MAX_EXEC_TIMEOUT_MS = 600000;
const MILLISECONDS_PER_SECOND = 1000;
const COMMAND_NOT_FOUND_EXIT_CODE = 127;
const UNUSABLE_FOLDERS_EXIT_CODE = 1;
const MISSING_PROGRAM_PATTERN = /ENOENT|not found|no such file/i;

const backendPath = () => `${appHome()}/mods/${MOD_NAME}/bin/herdwatch`;

/** @param {number} code @param {string} stderr @returns {BackendFailure} */
function exitFailure(code, stderr) {
  const detail = stderr.trim() || `backend exited with ${code}`;
  if (code === COMMAND_NOT_FOUND_EXIT_CODE) return { reason: "backend_missing", detail };
  if (code === UNUSABLE_FOLDERS_EXIT_CODE) return { reason: "runtime_dir", detail };
  return { reason: "mod_bug", detail };
}

/** @param {unknown} execError @returns {BackendFailure} */
function execFailure(execError) {
  const detail = String(execError);
  return { reason: MISSING_PROGRAM_PATTERN.test(detail) ? "backend_missing" : "mod_bug", detail };
}

/**
 * Herdr does not say whether exec stopped a program for its timeout, so a run that took the whole time counts as one.
 * @param {number} startedAt @param {number} timeoutMs
 */
const hasUsedWholeTimeout = (startedAt, timeoutMs) => Date.now() - startedAt >= timeoutMs;

/**
 * @param {string[]} backendArguments
 * @param {number} timeoutMs
 * @returns {Promise<BackendRunResult>}
 */
export async function runBackend(backendArguments, timeoutMs) {
  const startedAt = Date.now();
  try {
    const backendRun = await exec("bash", [backendPath(), ...backendArguments], { timeout: timeoutMs });
    if (backendRun.code === 0) return { ok: true, stdout: backendRun.stdout };
    if (hasUsedWholeTimeout(startedAt, timeoutMs)) return { ok: false, failure: { reason: "backend_timeout", detail: backendRun.stderr.trim() } };
    return { ok: false, failure: exitFailure(backendRun.code, backendRun.stderr) };
  } catch (execError) {
    if (hasUsedWholeTimeout(startedAt, timeoutMs)) return { ok: false, failure: { reason: "backend_timeout", detail: String(execError) } };
    return { ok: false, failure: execFailure(execError) };
  }
}

/**
 * Polls every host once and returns the checked snapshot.
 * @returns {Promise<SnapshotResult>}
 */
export async function runSnapshot() {
  const run = await runBackend(["snapshot"], SNAPSHOT_TIMEOUT_MS);
  if (run.ok === false) return run;
  return parseSnapshot(run.stdout);
}

/**
 * Measures the worktrees of every host; the next snapshot carries the new numbers.
 * @param {MonitorSettings} settings
 * @returns {Promise<BackendRunResult>}
 */
export function measureWorktrees(settings) {
  const timeoutMs = Math.min(settings.worktree_timeout * MILLISECONDS_PER_SECOND + WORKTREE_TIMEOUT_MARGIN_MS, MAX_EXEC_TIMEOUT_MS);
  return runBackend(["worktrees"], timeoutMs);
}

/**
 * Measures Docker on every host; the next snapshot carries the new lists.
 * @returns {Promise<BackendRunResult>}
 */
export const measureDocker = () => runBackend(["docker"], DOCKER_MEASURE_TIMEOUT_MS);
