import { runBackend } from "./backend.js";
import { isRecord } from "./snapshot.js";

/** @typedef {import("./schemas.js").ActionName} ActionName */
/** @typedef {import("./schemas.js").ActionResult} ActionResult */

const ACTION_TIMEOUT_MS = 240000;
const MILLISECONDS_PER_SECOND = 1000;
const UNREADABLE_OUTPUT_DETAIL_CHARACTERS = 200;
const ACTION_FAILURE_REASONS = new Set(["bad_input", "busy", "host_down", "not_owner", "still_running", "dirty", "agent_inside",
  "branch_not_merged", "docker_denied", "docker_missing", "remote_error", "backend_timeout"]);

/** @param {unknown} parsed @returns {ActionResult | null} */
function actionResultOrNull(parsed) {
  if (!isRecord(parsed) || typeof parsed.message !== "string") return null;
  if (parsed.ok === true) return { ok: true, message: parsed.message, data: isRecord(parsed.data) ? parsed.data : {} };
  const isKnownFailure = parsed.ok === false && ACTION_FAILURE_REASONS.has(parsed.reason);
  if (!isKnownFailure) return null;
  return { ok: false, reason: parsed.reason, message: parsed.message, detail: typeof parsed.detail === "string" ? parsed.detail : "" };
}

/** @param {string} text @returns {unknown} */
function parsedJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** @param {string} stdout @returns {ActionResult} */
function parseActionOutput(stdout) {
  const actionResult = actionResultOrNull(parsedJsonOrNull(stdout));
  if (actionResult) return actionResult;
  return { ok: false, reason: "remote_error", message: "The backend answered with data that the console cannot read.", detail: stdout.slice(0, UNREADABLE_OUTPUT_DETAIL_CHARACTERS) };
}

/**
 * Runs one action on one host through the backend, which checks every value before it reaches the host.
 * @param {ActionName} name
 * @param {string} label
 * @param {string[]} actionArguments
 * @returns {Promise<ActionResult>}
 */
export async function runAction(name, label, actionArguments) {
  const backendRun = await runBackend(["action", name, label, ...actionArguments], ACTION_TIMEOUT_MS);
  if (backendRun.ok === true) return parseActionOutput(backendRun.stdout);
  const { reason, detail } = backendRun.failure;
  if (reason === "backend_timeout") {
    const timeoutSeconds = ACTION_TIMEOUT_MS / MILLISECONDS_PER_SECOND;
    return { ok: false, reason, message: `The action took longer than ${timeoutSeconds} s. It can still finish on the host.`, detail };
  }
  return { ok: false, reason: "remote_error", message: "The Herdwatch backend failed.", detail };
}
