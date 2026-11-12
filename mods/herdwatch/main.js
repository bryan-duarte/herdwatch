import { View } from "gpui-kit";
import { appHome, exec, focused, keys, nextCommand, notify, panes, playSound, props, run, setShared, shared, theme, window as herdrWindow } from "herdr";
import { agentViews, herdrAgents } from "./agents.js";
import { renderBar } from "./bar.js";
import { renderConsole } from "./console.js";
import { nowInSeconds } from "./format.js";
import { historyOrEmpty, nextHistory } from "./history.js";
import { isPollLeaseHeldByAnotherCopy, monitorStateOrNull, parseSnapshot, worktreesOrEmpty } from "./snapshot.js";

/** @typedef {import("./types.js").HotHostAlert} HotHostAlert */
/** @typedef {import("./types.js").MonitorState} MonitorState */
/** @typedef {import("./types.js").MonitorHistory} MonitorHistory */
/** @typedef {import("./types.js").ProcessSort} ProcessSort */
/** @typedef {import("./types.js").ConsoleTab} ConsoleTab */
/** @typedef {import("./types.js").WorktreeFilter} WorktreeFilter */
/** @typedef {import("./types.js").WorktreesByHost} WorktreesByHost */
/** @typedef {import("./types.js").Snapshot} Snapshot */
/** @typedef {import("./types.js").SnapshotResult} SnapshotResult */
/** @typedef {import("./types.js").ThemeColors} ThemeColors */
/** @typedef {import("./types.js").ModContext} ModContext */
/** @typedef {import("gpui-kit").KeyEvent} KeyEvent */

const MOD_NAME = "herdwatch";
const MONITOR_STATE_KEY = "herdwatch.state";
const HISTORY_KEY = "herdwatch.history";
const WORKTREES_KEY = "herdwatch.worktrees";
const SORT_KEY = "herdwatch.sort";
const VIEW_STORAGE_KEY = "herdwatch.view";
const POLLER_KEY = "herdwatch.poller";
const TOGGLE_COMMAND = "toggle";
const FOCUS_COMMAND = "focus";
const SORT_KEYS = /** @type {Record<string, ProcessSort>} */ ({ c: "cpu", m: "mem" });
const CONSOLE_TABS = /** @type {ConsoleTab[]} */ (["overview", "agents", "ports", "worktrees", "procs"]);
const WORKTREE_FILTERS = /** @type {WorktreeFilter[]} */ (["all", "stale", "changed", "agent", "behind"]);
const RANGE_SAMPLES = [24, 60, 120];
const DEFAULT_RANGE_SAMPLES = 60;
const POLL_INTERVAL_MS = 5000;
const POLL_LEASE_SECONDS = 12;
const BACKEND_TIMEOUT_MS = 20000;
const WORKTREE_TIMEOUT_MARGIN_MS = 30000;
const MAX_EXEC_TIMEOUT_MS = 600000;
const DEFAULT_DETAIL_REFRESH_MS = 2000;
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_DETAIL_WIDTH_PX = 640;
const MONOSPACE_FONT = "JetBrains Mono";
/** @type {Record<string, string>} */
const MAC_KEY_SYMBOLS = { cmd: "⌘", ctrl: "⌃", shift: "⇧", alt: "⌥", option: "⌥" };

const readMonitorState = () => monitorStateOrNull(shared(MONITOR_STATE_KEY));
const readHistory = () => historyOrEmpty(shared(HISTORY_KEY));
const readWorktrees = () => worktreesOrEmpty(shared(WORKTREES_KEY));
/** @returns {ProcessSort} */
const readSort = () => (shared(SORT_KEY) === "mem" ? "mem" : "cpu");
/** @param {ProcessSort} sort */
const setSort = (sort) => setShared(SORT_KEY, sort);
const themeColors = () => /** @type {ThemeColors} */ (theme());
const backendPath = () => `${appHome()}/mods/${MOD_NAME}/bin/herdwatch`;

/**
 * One copy polls at a time: the copy that holds the lease, or any copy once the lease is older than POLL_LEASE_SECONDS.
 * So the console keeps its data fresh when no pill is shown, and a pill and a console never poll together.
 * @param {string} copyId
 */
function takePollLease(copyId) {
  const now = nowInSeconds();
  if (isPollLeaseHeldByAnotherCopy(shared(POLLER_KEY), copyId, now, POLL_LEASE_SECONDS)) return false;
  setShared(POLLER_KEY, { owner: copyId, at: now });
  return true;
}

function shortcutLabel() {
  const binding = keys().find((key) => key.action === `${MOD_NAME}.${TOGGLE_COMMAND}`);
  if (!binding) return null;
  const isMac = herdrWindow()?.platform === "macos";
  return binding.keys.split("-").map((part) => (isMac ? MAC_KEY_SYMBOLS[part] : null) ?? part.toUpperCase()).join(isMac ? "" : "+");
}

/** @returns {Promise<SnapshotResult>} */
async function runSnapshot() {
  const result = await exec("bash", [backendPath(), "snapshot"], { timeout: BACKEND_TIMEOUT_MS });
  if (result.code !== 0) return { ok: false, error: result.stderr.trim() || `backend exited with ${result.code}` };
  return parseSnapshot(result.stdout);
}

/** @param {Snapshot} snapshot */
async function runWorktreeMeasure(snapshot) {
  const timeout = Math.min(snapshot.settings.worktree_timeout * MILLISECONDS_PER_SECOND + WORKTREE_TIMEOUT_MARGIN_MS, MAX_EXEC_TIMEOUT_MS);
  await exec("bash", [backendPath(), "worktrees"], { timeout });
}

/** @param {HotHostAlert[]} alerts */
function announceAlerts(alerts) {
  for (const alert of alerts) {
    notify({
      title: `herdwatch: ${alert.label} is hot`,
      body: `CPU ${alert.cpu_pct ?? "?"}% · MEM ${alert.mem_pct ?? "?"}% · top: ${alert.top_process || "?"}`,
      level: "warning",
    });
    playSound("blocked");
  }
}

/** @param {WorktreesByHost} worktrees */
const worktreeSignature = (worktrees) => Object.entries(worktrees)
  .map(([label, value]) => `${label}:${value.state}:${value.measured_at}:${value.items.length}`).sort().join("|");

/**
 * Splits the worktree lists out of the snapshot, so the 5 s state update stays small.
 * @param {Snapshot} snapshot
 * @returns {{ light: Snapshot, worktrees: WorktreesByHost }}
 */
function splitWorktrees(snapshot) {
  /** @type {WorktreesByHost} */
  const worktrees = {};
  const hosts = snapshot.hosts.map((host) => {
    worktrees[host.label] = host.worktrees;
    return { ...host, worktrees: { ...host.worktrees, items: /** @type {import("./types.js").WorktreeItem[]} */ ([]) } };
  });
  return { light: { ...snapshot, hosts }, worktrees };
}

/** @param {string | undefined} tab */
const detailPaneIn = (tab) => panes().find((pane) => pane.mod === MOD_NAME && pane.tab === tab);

function closeDetail() {
  const openDetail = detailPaneIn(focused()?.tab);
  if (openDetail) run("pane.close", { pane: openDetail.pane });
}

function toggleDetail() {
  const current = focused();
  if (!current?.tab) return;
  const openDetail = detailPaneIn(current.tab);
  if (openDetail) {
    run("pane.close", { pane: openDetail.pane });
    return;
  }
  const previousPane = current.pane;
  run("pane.split", { direction: "right", mod: MOD_NAME, props: { view: "detail" }, ...(previousPane ? { pane: previousPane } : {}) });
  if (previousPane) run("pane.focus", { pane: previousPane });
}

/**
 * @typedef {object} DetailChoices
 * @property {string | null} host
 * @property {ConsoleTab} tab
 * @property {number} range
 * @property {WorktreeFilter} filter
 */

/** @returns {DetailChoices} */
function loadDetailChoices() {
  /** @type {DetailChoices} */
  const defaults = { host: null, tab: "overview", range: DEFAULT_RANGE_SAMPLES, filter: "all" };
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY) ?? "{}");
    return {
      host: typeof stored.host === "string" ? stored.host : null,
      tab: CONSOLE_TABS.includes(stored.tab) ? stored.tab : defaults.tab,
      range: RANGE_SAMPLES.includes(stored.range) ? stored.range : defaults.range,
      filter: WORKTREE_FILTERS.includes(stored.filter) ? stored.filter : defaults.filter,
    };
  } catch {
    return defaults;
  }
}

export default class Herdwatch extends View {
  /** @param {unknown} _props @param {ModContext} cx */
  init(_props, cx) {
    this.isBar = props()?.view !== "detail";
    this.copyId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.startPolling(cx);
    if (this.isBar) this.listenForToggle(cx);
    else this.startDetail(cx);
  }

  /** @param {ModContext} cx */
  startPolling(cx) {
    this.pollRunning = false;
    this.worktreeMeasureRunning = false;
    /** @type {string} */
    this.lastWorktreeSignature = "";
    cx.timer.every(POLL_INTERVAL_MS, (timerCx) => this.pollWithLease(timerCx));
    this.pollWithLease(cx);
  }

  /** @param {ModContext} cx */
  pollWithLease(cx) {
    if (takePollLease(this.copyId)) this.poll(cx);
  }

  /** @param {ModContext} cx */
  listenForToggle(cx) {
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (command === TOGGLE_COMMAND) toggleDetail();
      }
    });
  }

  /** @param {ModContext} cx */
  poll(cx) {
    if (this.pollRunning) return;
    this.pollRunning = true;
    cx.spawn(async () => {
      try {
        const outcome = await runSnapshot();
        if (!("snapshot" in outcome)) {
          setShared(MONITOR_STATE_KEY, { snapshot: readMonitorState()?.snapshot ?? null, error: outcome.error });
          return;
        }
        const { light, worktrees } = splitWorktrees(outcome.snapshot);
        const signature = worktreeSignature(worktrees);
        if (signature !== this.lastWorktreeSignature) {
          this.lastWorktreeSignature = signature;
          setShared(WORKTREES_KEY, worktrees);
        }
        setShared(HISTORY_KEY, nextHistory(readHistory(), outcome.snapshot, nowInSeconds()));
        setShared(MONITOR_STATE_KEY, { snapshot: light, error: null });
        announceAlerts(outcome.snapshot.alerts);
        if (outcome.snapshot.worktrees_due) this.measureWorktrees(cx, outcome.snapshot);
      } catch (execError) {
        setShared(MONITOR_STATE_KEY, { snapshot: readMonitorState()?.snapshot ?? null, error: String(execError) });
      } finally {
        this.pollRunning = false;
      }
    });
  }

  /** @param {ModContext} cx @param {Snapshot} snapshot */
  measureWorktrees(cx, snapshot) {
    if (this.worktreeMeasureRunning) return;
    this.worktreeMeasureRunning = true;
    cx.spawn(async () => {
      try {
        await runWorktreeMeasure(snapshot);
      } catch (execError) {
        console.log("herdwatch_worktree_measure_failed", String(execError));
      } finally {
        this.worktreeMeasureRunning = false;
      }
    });
  }

  /** @param {ModContext} cx */
  startDetail(cx) {
    this.focusHandle = cx.focus_handle();
    /** @type {number} */
    this.width = DEFAULT_DETAIL_WIDTH_PX;
    this.choices = loadDetailChoices();
    const refreshSeconds = readMonitorState()?.snapshot?.settings?.pane_refresh;
    const refreshMs = Number.isFinite(refreshSeconds) ? refreshSeconds * MILLISECONDS_PER_SECOND : DEFAULT_DETAIL_REFRESH_MS;
    cx.timer.every(refreshMs, (timerCx) => timerCx.notify());
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (command === FOCUS_COMMAND) this.focusHandle.focus();
      }
    });
  }

  /** @param {Partial<DetailChoices>} change */
  choose(change) {
    this.choices = { ...this.choices, ...change };
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(this.choices));
    } catch (storageError) {
      console.log("herdwatch_view_not_saved", String(storageError));
    }
  }

  /** @param {KeyEvent} event @param {ModContext} cx */
  handleDetailKey(event, cx) {
    const hasModifier = event.modifiers?.platform || event.modifiers?.control || event.modifiers?.alt;
    if (hasModifier) return;
    const sort = SORT_KEYS[event.key];
    if (sort) setSort(sort);
    const hostIndex = Number(event.key) - 1;
    const hosts = readMonitorState()?.snapshot?.hosts ?? [];
    if (Number.isInteger(hostIndex) && hostIndex >= 0 && hostIndex < hosts.length) {
      this.choose({ host: hosts[hostIndex].label });
      cx.notify();
    }
  }

  /** @param {ModContext} cx */
  takeKeyboard(cx) {
    this.focusHandle.focus();
    cx.notify();
  }

  /** @param {number} nextWidth @param {ModContext} cx */
  updateWidth(nextWidth, cx) {
    if (nextWidth === this.width) return;
    this.width = nextWidth;
    cx.notify();
  }

  /** @param {ModContext} cx */
  renderDetail(cx) {
    const monitorState = readMonitorState();
    const history = readHistory();
    const hosts = monitorState?.snapshot?.hosts ?? [];
    const host = hosts.find((item) => item.label === this.choices.host) ?? hosts[0] ?? null;
    const view = {
      monitorState,
      history,
      worktrees: readWorktrees(),
      host,
      agents: host ? agentViews(host, history, herdrAgents()) : [],
      tab: this.choices.tab,
      rangeSamples: this.choices.range,
      sort: readSort(),
      worktreeFilter: this.choices.filter,
      shortcut: shortcutLabel(),
      hasKeyboard: this.focusHandle.is_focused(),
      width: this.width,
      onHost: (/** @type {string} */ label) => { this.choose({ host: label }); cx.notify(); },
      onTab: (/** @type {ConsoleTab} */ tab) => { this.choose({ tab }); cx.notify(); },
      onRange: (/** @type {number} */ range) => { this.choose({ range }); cx.notify(); },
      onSort: setSort,
      onWorktreeFilter: (/** @type {WorktreeFilter} */ filter) => { this.choose({ filter }); cx.notify(); },
      onClose: closeDetail,
    };
    return renderConsole(view, MONOSPACE_FONT)
      .track_focus(this.focusHandle)
      .on_key_down((/** @type {KeyEvent} */ event, /** @type {ModContext} */ keyCx) => this.handleDetailKey(event, keyCx))
      .on_mouse_down("left", (/** @type {unknown} */ _event, /** @type {ModContext} */ mouseCx) => this.takeKeyboard(mouseCx))
      .on_size_change((/** @type {{ width: number }} */ size, /** @type {ModContext} */ sizeCx) => this.updateWidth(size.width, sizeCx));
  }

  /** @param {ModContext} cx */
  render(cx) {
    if (!this.isBar) return this.renderDetail(cx);
    const barView = { monitorState: readMonitorState(), isDetailOpen: Boolean(detailPaneIn(focused()?.tab)), shortcut: shortcutLabel(), onToggleDetail: toggleDetail };
    return renderBar(barView, themeColors(), MONOSPACE_FONT);
  }
}
