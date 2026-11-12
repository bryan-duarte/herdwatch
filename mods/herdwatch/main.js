import { View } from "gpui-kit";
import { nextCommand, theme } from "herdr";
import { agentViews, herdrAgents } from "./agents.js";
import { closeConsole, isConsoleCopy, isConsoleOpenInFocusedTab, toggleConsole, toggleShortcutLabel } from "./console-pane.js";
import { FOCUS_COMMAND, MONOSPACE_FONT, TOGGLE_COMMAND } from "./mod.js";
import { Poller } from "./poller.js";
import { loadConsoleChoices, readHistory, readMonitorState, readSort, readWorktrees, saveConsoleChoices, saveSort } from "./store.js";
import { renderBar } from "./views/bar.js";
import { renderConsole } from "./views/console.js";

/** @typedef {import("gpui-kit").KeyEvent} KeyEvent */
/** @typedef {import("./schemas.js").ConsoleChoices} ConsoleChoices */
/** @typedef {import("./schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("./schemas.js").ModContext} ModContext */
/** @typedef {import("./schemas.js").ProcessSort} ProcessSort */
/** @typedef {import("./schemas.js").ThemeColors} ThemeColors */

const DEFAULT_CONSOLE_REFRESH_MS = 2000;
const DEFAULT_CONSOLE_WIDTH_PX = 640;
const WIDE_CONSOLE_PX = 560;
const MILLISECONDS_PER_SECOND = 1000;
/** @type {Record<string, ProcessSort>} */
const SORT_KEYS = { c: "cpu", m: "mem" };

/**
 * @param {ModContext} cx
 * @param {Record<string, () => void>} handlers
 */
function handleCommands(cx, handlers) {
  cx.spawn(async () => {
    for (;;) {
      const command = await nextCommand();
      handlers[command]?.();
    }
  });
}

/** @param {KeyEvent} event */
const hasModifier = (event) => Boolean(event.modifiers?.platform || event.modifiers?.control || event.modifiers?.alt);

/**
 * One class serves both copies of the mod: the pill in the tab row, and the console pane the pill opens.
 */
export default class Herdwatch extends View {
  /** @param {unknown} _props @param {ModContext} cx */
  init(_props, cx) {
    new Poller().start(cx);
    this.isConsole = isConsoleCopy();
    if (this.isConsole) this.initConsole(cx);
    else handleCommands(cx, { [TOGGLE_COMMAND]: toggleConsole });
  }

  /** @param {ModContext} cx */
  initConsole(cx) {
    this.focusHandle = cx.focus_handle();
    /** @type {number} */
    this.width = DEFAULT_CONSOLE_WIDTH_PX;
    /** @type {ConsoleChoices} */
    this.choices = loadConsoleChoices();
    const refreshSeconds = readMonitorState()?.snapshot?.settings?.pane_refresh;
    const refreshMs = Number.isFinite(refreshSeconds) ? refreshSeconds * MILLISECONDS_PER_SECOND : DEFAULT_CONSOLE_REFRESH_MS;
    cx.timer.every(refreshMs, (timerCx) => timerCx.notify());
    handleCommands(cx, { [FOCUS_COMMAND]: () => this.focusHandle.focus() });
  }

  /** @param {Partial<ConsoleChoices>} change @param {ModContext} cx */
  choose(change, cx) {
    this.choices = { ...this.choices, ...change };
    saveConsoleChoices(this.choices);
    cx.notify();
  }

  /**
   * c and m sort the processes; 1 to 9 pick a host.
   * @param {KeyEvent} event
   * @param {ModContext} cx
   */
  handleConsoleKey(event, cx) {
    if (hasModifier(event)) return;
    const sort = SORT_KEYS[event.key];
    if (sort) saveSort(sort);
    const hosts = readMonitorState()?.snapshot?.hosts ?? [];
    const hostIndex = Number(event.key) - 1;
    const isHostKey = Number.isInteger(hostIndex) && hostIndex >= 0 && hostIndex < hosts.length;
    if (isHostKey) this.choose({ host: hosts[hostIndex].label }, cx);
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

  /** @param {ModContext} cx @returns {ConsoleView} */
  consoleView(cx) {
    const monitorState = readMonitorState();
    const history = readHistory();
    const hosts = monitorState?.snapshot?.hosts ?? [];
    const host = hosts.find((candidate) => candidate.label === this.choices.host) ?? hosts[0] ?? null;
    return {
      monitorState,
      history,
      worktrees: readWorktrees(),
      host,
      agents: host ? agentViews(host, history, herdrAgents()) : [],
      tab: this.choices.tab,
      rangeSamples: this.choices.range,
      sort: readSort(),
      worktreeFilter: this.choices.filter,
      shortcut: toggleShortcutLabel(),
      hasKeyboard: this.focusHandle.is_focused(),
      isWide: this.width >= WIDE_CONSOLE_PX,
      onHost: (label) => this.choose({ host: label }, cx),
      onTab: (tab) => this.choose({ tab }, cx),
      onRange: (range) => this.choose({ range }, cx),
      onSort: saveSort,
      onWorktreeFilter: (filter) => this.choose({ filter }, cx),
      onClose: closeConsole,
    };
  }

  /** @param {ModContext} cx */
  renderConsolePane(cx) {
    return renderConsole(this.consoleView(cx), MONOSPACE_FONT)
      .track_focus(this.focusHandle)
      .on_key_down((/** @type {KeyEvent} */ event, /** @type {ModContext} */ keyCx) => this.handleConsoleKey(event, keyCx))
      .on_mouse_down("left", (/** @type {unknown} */ _event, /** @type {ModContext} */ mouseCx) => this.takeKeyboard(mouseCx))
      .on_size_change((/** @type {{ width: number }} */ size, /** @type {ModContext} */ sizeCx) => this.updateWidth(size.width, sizeCx));
  }

  /** @param {ModContext} cx */
  render(cx) {
    if (this.isConsole) return this.renderConsolePane(cx);
    const barView = {
      monitorState: readMonitorState(),
      isConsoleOpen: isConsoleOpenInFocusedTab(),
      shortcut: toggleShortcutLabel(),
      onToggleConsole: toggleConsole,
    };
    return renderBar(barView, /** @type {ThemeColors} */ (theme()), MONOSPACE_FONT);
  }
}
