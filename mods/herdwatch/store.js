import { setShared, shared } from "herdr";
import { dockerOrEmpty } from "./docker.js";
import { CHART_RANGE_SAMPLES, DEFAULT_CHART_RANGE_SAMPLES, historyOrEmpty } from "./history.js";
import { isRecord, monitorStateOrNull } from "./snapshot.js";
import { WORKTREE_FILTER_NAMES, worktreesOrEmpty } from "./worktrees.js";

/** @typedef {import("./schemas.js").BackendFailure} BackendFailure */
/** @typedef {import("./schemas.js").ConsoleChoices} ConsoleChoices */
/** @typedef {import("./schemas.js").DockerByHost} DockerByHost */
/** @typedef {import("./schemas.js").ConsoleTab} ConsoleTab */
/** @typedef {import("./schemas.js").MonitorData} MonitorData */
/** @typedef {import("./schemas.js").MonitorHistory} MonitorHistory */
/** @typedef {import("./schemas.js").PollLease} PollLease */
/** @typedef {import("./schemas.js").ProcessSort} ProcessSort */
/** @typedef {import("./schemas.js").PublishedSignatures} PublishedSignatures */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */
/** @typedef {import("./schemas.js").WorktreesByHost} WorktreesByHost */

const SHARED_KEYS = {
  monitorState: "herdwatch.state",
  worktrees: "herdwatch.worktrees",
  docker: "herdwatch.docker",
};
const OLD_HISTORY_KEY = "herdwatch.history";
/** Keys of older versions and older names of this mod. Herdr rewrites all of shared state on each write, so a dead key costs on every write. */
const RETIRED_SHARED_KEYS = [
  OLD_HISTORY_KEY, "herdwatch.poller", "herdwatch.sort",
  "hostmon.state", "hostmon.history", "hostmon.sort", "hostmon.worktrees",
  "sheepdog.state", "sheepdog.history", "sheepdog.worktrees",
];
const CONSOLE_CHOICES_STORAGE_KEY = "herdwatch.view";
const POLL_LEASE_SECONDS = 12;
const PROCESS_SORTS = /** @type {ProcessSort[]} */ (["cpu", "mem"]);
export const CONSOLE_TABS = /** @type {ConsoleTab[]} */ (["overview", "agents", "ports", "worktrees", "docker", "procs"]);

/** @type {ConsoleChoices} */
const DEFAULT_CONSOLE_CHOICES = { host: null, tab: "overview", range: DEFAULT_CHART_RANGE_SAMPLES, filter: "all", sort: "cpu" };

/** @type {PublishedSignatures} */
const NO_SIGNATURES = { worktrees: "", docker: "" };

/** @param {unknown} stored */
const historyOfRecord = (stored) => historyOrEmpty(isRecord(stored) ? stored.history : null);

/** @param {unknown} stored @returns {PublishedSignatures} */
function signaturesOfRecord(stored) {
  const signatures = isRecord(stored) ? stored.signatures : null;
  const isValid = isRecord(signatures) && typeof signatures.worktrees === "string" && typeof signatures.docker === "string";
  return isValid ? /** @type {PublishedSignatures} */ (signatures) : NO_SIGNATURES;
}

/**
 * The state, the history and the list signatures from one shared read, because each read copies the whole value.
 * @returns {MonitorData}
 */
export function readMonitorData() {
  const stored = shared(SHARED_KEYS.monitorState);
  return { monitorState: monitorStateOrNull(stored), history: historyOfRecord(stored), signatures: signaturesOfRecord(stored) };
}

/**
 * A large shared list, read again only when the poller publishes a new measure of it. Every render and every copy
 * of the mod gets the same cached value, so a view must copy a list before it sorts or changes it.
 * @template T
 */
class SignatureCachedList {
  /** @param {string} key @param {(stored: unknown) => T} validate */
  constructor(key, validate) {
    this.key = key;
    this.validate = validate;
    this.signature = "";
    /** @type {T | null} */
    this.value = null;
  }

  /** @param {string} signature "" reads shared state every time */
  read(signature) {
    const isCachedMeasure = signature !== "" && signature === this.signature;
    if (isCachedMeasure) return this.value;
    this.value = this.validate(shared(this.key));
    this.signature = signature;
    return this.value;
  }
}

const worktreesList = new SignatureCachedList(SHARED_KEYS.worktrees, worktreesOrEmpty);
const dockerList = new SignatureCachedList(SHARED_KEYS.docker, dockerOrEmpty);

export const readMonitorState = () => monitorStateOrNull(shared(SHARED_KEYS.monitorState));
export const readHistory = () => historyOfRecord(shared(SHARED_KEYS.monitorState));
/** @param {string} [signature] the published signature of the list; without one, shared state is read */
export const readWorktrees = (signature = "") => worktreesList.read(signature);
/** @param {string} [signature] the published signature of the list; without one, shared state is read */
export const readDocker = (signature = "") => dockerList.read(signature);

/**
 * One write per poll, because each shared write redraws every Herdr mod.
 * @param {Snapshot} lightSnapshot @param {MonitorHistory} history @param {PublishedSignatures} signatures
 */
export function publishPoll(lightSnapshot, history, signatures) {
  setShared(SHARED_KEYS.monitorState, { snapshot: lightSnapshot, error: null, history, signatures });
}

/** @param {WorktreesByHost} worktreesByHost */
export const publishWorktrees = (worktreesByHost) => setShared(SHARED_KEYS.worktrees, worktreesByHost);

/** @param {DockerByHost} dockerByHost */
export const publishDocker = (dockerByHost) => setShared(SHARED_KEYS.docker, dockerByHost);

/**
 * The last good snapshot and its history stay on screen next to the failure.
 * @param {BackendFailure} failure
 */
export function publishPollError(failure) {
  const { monitorState, history, signatures } = readMonitorData();
  setShared(SHARED_KEYS.monitorState, { snapshot: monitorState?.snapshot ?? null, error: failure, history, signatures });
}

/**
 * Every copy of the mod shares this module (Herdr runs module code once per source version), so the lease needs no
 * shared write. A new source version starts a new module, and with it a free lease.
 * @type {PollLease}
 */
const pollLease = { owner: "", at: 0 };

export const resetPollLease = () => Object.assign(pollLease, { owner: "", at: 0 });

/**
 * Every copy of the mod (the pill and each console) ticks, but one copy polls at a time:
 * the copy that holds the lease, or any copy once the lease is older than POLL_LEASE_SECONDS.
 * @param {string} copyId
 * @param {number} now
 */
export function takePollLease(copyId, now) {
  const isHeldByAnotherCopy = pollLease.owner !== "" && pollLease.owner !== copyId && now - pollLease.at < POLL_LEASE_SECONDS;
  if (isHeldByAnotherCopy) return false;
  Object.assign(pollLease, { owner: copyId, at: now });
  return true;
}

/** The version before one write per poll kept the history in a key of its own; the charts keep it across the update. */
function adoptOldHistory() {
  const stored = shared(SHARED_KEYS.monitorState);
  const oldHistory = shared(OLD_HISTORY_KEY);
  const needsOldHistory = isRecord(stored) && !isRecord(stored.history) && isRecord(oldHistory);
  if (needsOldHistory) setShared(SHARED_KEYS.monitorState, { ...stored, history: oldHistory });
}

let hasRetiredOldKeys = false;

export function retireOldSharedKeys() {
  if (hasRetiredOldKeys) return;
  hasRetiredOldKeys = true;
  adoptOldHistory();
  RETIRED_SHARED_KEYS.filter((key) => shared(key) != null).forEach((key) => setShared(key, null));
}

/** @param {unknown} stored @returns {ConsoleChoices} */
function consoleChoicesOrDefault(stored) {
  if (!isRecord(stored)) return DEFAULT_CONSOLE_CHOICES;
  return {
    host: typeof stored.host === "string" ? stored.host : null,
    tab: CONSOLE_TABS.includes(stored.tab) ? stored.tab : DEFAULT_CONSOLE_CHOICES.tab,
    range: CHART_RANGE_SAMPLES.includes(stored.range) ? stored.range : DEFAULT_CONSOLE_CHOICES.range,
    filter: WORKTREE_FILTER_NAMES.includes(stored.filter) ? stored.filter : DEFAULT_CONSOLE_CHOICES.filter,
    sort: PROCESS_SORTS.includes(stored.sort) ? stored.sort : DEFAULT_CONSOLE_CHOICES.sort,
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
