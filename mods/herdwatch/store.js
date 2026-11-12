import { setShared, shared } from "herdr";
import { dockerOrEmpty } from "./docker.js";
import { CHART_RANGE_SAMPLES, DEFAULT_CHART_RANGE_SAMPLES, historyOrEmpty } from "./history.js";
import { isRecord, monitorStateOrNull } from "./snapshot.js";
import { WORKTREE_FILTER_NAMES, worktreesOrEmpty } from "./worktrees.js";

/** @typedef {import("./schemas.js").BackendFailure} BackendFailure */
/** @typedef {import("./schemas.js").ConsoleChoices} ConsoleChoices */
/** @typedef {import("./schemas.js").DockerByHost} DockerByHost */
/** @typedef {import("./schemas.js").ConsoleTab} ConsoleTab */
/** @typedef {import("./schemas.js").MonitorHistory} MonitorHistory */
/** @typedef {import("./schemas.js").ProcessSort} ProcessSort */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */
/** @typedef {import("./schemas.js").WorktreesByHost} WorktreesByHost */

const SHARED_KEYS = {
  monitorState: "herdwatch.state",
  history: "herdwatch.history",
  worktrees: "herdwatch.worktrees",
  docker: "herdwatch.docker",
  sort: "herdwatch.sort",
  pollLease: "herdwatch.poller",
};
const CONSOLE_CHOICES_STORAGE_KEY = "herdwatch.view";
const POLL_LEASE_SECONDS = 12;
export const CONSOLE_TABS = /** @type {ConsoleTab[]} */ (["overview", "agents", "ports", "worktrees", "docker", "procs"]);

/** @type {ConsoleChoices} */
const DEFAULT_CONSOLE_CHOICES = { host: null, tab: "overview", range: DEFAULT_CHART_RANGE_SAMPLES, filter: "all" };

export const readMonitorState = () => monitorStateOrNull(shared(SHARED_KEYS.monitorState));
export const readHistory = () => historyOrEmpty(shared(SHARED_KEYS.history));
export const readWorktrees = () => worktreesOrEmpty(shared(SHARED_KEYS.worktrees));
export const readDocker = () => dockerOrEmpty(shared(SHARED_KEYS.docker));

/** @returns {ProcessSort} */
export const readSort = () => (shared(SHARED_KEYS.sort) === "mem" ? "mem" : "cpu");

/** @param {ProcessSort} sort */
export const saveSort = (sort) => setShared(SHARED_KEYS.sort, sort);

/** @param {Snapshot} lightSnapshot @param {MonitorHistory} history */
export function publishPoll(lightSnapshot, history) {
  setShared(SHARED_KEYS.history, history);
  setShared(SHARED_KEYS.monitorState, { snapshot: lightSnapshot, error: null });
}

/** @param {WorktreesByHost} worktreesByHost */
export const publishWorktrees = (worktreesByHost) => setShared(SHARED_KEYS.worktrees, worktreesByHost);

/** @param {DockerByHost} dockerByHost */
export const publishDocker = (dockerByHost) => setShared(SHARED_KEYS.docker, dockerByHost);

/**
 * The last good snapshot stays on screen next to the failure.
 * @param {BackendFailure} failure
 */
export const publishPollError = (failure) => setShared(SHARED_KEYS.monitorState, { snapshot: readMonitorState()?.snapshot ?? null, error: failure });

/** @param {unknown} stored @param {string} copyId @param {number} now */
function isLeaseHeldByAnotherCopy(stored, copyId, now) {
  const isValidLease = isRecord(stored) && typeof stored.owner === "string" && Number.isFinite(stored.at);
  if (!isValidLease) return false;
  return stored.owner !== copyId && now - stored.at < POLL_LEASE_SECONDS;
}

/**
 * Every copy of the mod (the pill and each console) ticks, but one copy polls at a time:
 * the copy that holds the lease, or any copy once the lease is older than POLL_LEASE_SECONDS.
 * @param {string} copyId
 * @param {number} now
 */
export function takePollLease(copyId, now) {
  if (isLeaseHeldByAnotherCopy(shared(SHARED_KEYS.pollLease), copyId, now)) return false;
  setShared(SHARED_KEYS.pollLease, { owner: copyId, at: now });
  return true;
}

/** @param {unknown} stored @returns {ConsoleChoices} */
function consoleChoicesOrDefault(stored) {
  if (!isRecord(stored)) return DEFAULT_CONSOLE_CHOICES;
  return {
    host: typeof stored.host === "string" ? stored.host : null,
    tab: CONSOLE_TABS.includes(stored.tab) ? stored.tab : DEFAULT_CONSOLE_CHOICES.tab,
    range: CHART_RANGE_SAMPLES.includes(stored.range) ? stored.range : DEFAULT_CONSOLE_CHOICES.range,
    filter: WORKTREE_FILTER_NAMES.includes(stored.filter) ? stored.filter : DEFAULT_CONSOLE_CHOICES.filter,
  };
}

/** @returns {ConsoleChoices} */
export function loadConsoleChoices() {
  try {
    return consoleChoicesOrDefault(JSON.parse(localStorage.getItem(CONSOLE_CHOICES_STORAGE_KEY) ?? "{}"));
  } catch {
    return DEFAULT_CONSOLE_CHOICES;
  }
}

/** @param {ConsoleChoices} choices */
export function saveConsoleChoices(choices) {
  try {
    localStorage.setItem(CONSOLE_CHOICES_STORAGE_KEY, JSON.stringify(choices));
  } catch (storageError) {
    console.log("herdwatch_console_choices_not_saved", String(storageError));
  }
}
