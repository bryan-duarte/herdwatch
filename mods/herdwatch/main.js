import { View } from "gpui-kit";
import { nextCommand, notify, theme } from "herdr";
import { dockerContainerDialog, dockerPruneDialog, killDialog, worktreeDialog } from "./action-dialogs.js";
import { runAction } from "./actions.js";
import { agentViews, herdrAgents } from "./agents.js";
import { closeConsole, closeThisDialog, copyRole, dialogPendingId, isConsoleOpenInFocusedTab, openConfirmDialog, toggleConsole, toggleShortcutLabel } from "./console-pane.js";
import { FOCUS_COMMAND, MONOSPACE_FONT, TOGGLE_COMMAND } from "./mod.js";
import { clearPendingAction, readPendingAction, storePendingAction } from "./pending-action.js";
import { Poller } from "./poller.js";
import { loadConsoleChoices, readDocker, readHistory, readMonitorState, readSort, readWorktrees, saveConsoleChoices, saveSort } from "./store.js";
import { OPENING_TUNNEL_NOTE, portNoteKey, runningTunnels, startTunnel, stopTunnel, tunnelOfPort } from "./tunnels.js";
import { renderBar } from "./views/bar.js";
import { renderConfirmDialog } from "./views/confirm-dialog.js";
import { renderConsole } from "./views/console.js";

/** @typedef {import("gpui-kit").KeyEvent} KeyEvent */
/** @typedef {import("./action-dialogs.js").DialogCopy} DialogCopy */
/** @typedef {import("./schemas.js").ActionResult} ActionResult */
/** @typedef {import("./schemas.js").ConsoleChoices} ConsoleChoices */
/** @typedef {import("./schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("./schemas.js").CopyRole} CopyRole */
/** @typedef {import("./schemas.js").DialogState} DialogState */
/** @typedef {import("./schemas.js").DialogView} DialogView */
/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").ListeningPort} ListeningPort */
/** @typedef {import("./schemas.js").ModAsyncContext} ModAsyncContext */
/** @typedef {import("./schemas.js").ModContext} ModContext */
/** @typedef {import("./schemas.js").PendingAction} PendingAction */
/** @typedef {import("./schemas.js").PortActions} PortActions */
/** @typedef {import("./schemas.js").ProcessSort} ProcessSort */
/** @typedef {import("./schemas.js").ThemeColors} ThemeColors */
/** @typedef {import("./schemas.js").Tunnel} Tunnel */

const DEFAULT_CONSOLE_REFRESH_MS = 2000;
const DEFAULT_CONSOLE_WIDTH_PX = 640;
const WIDE_CONSOLE_PX = 560;
const MILLISECONDS_PER_SECOND = 1000;
/** @type {Record<string, ProcessSort>} */
const SORT_KEYS = { c: "cpu", m: "mem" };
const CONFIRM_KEY = "enter";
const CANCEL_KEY = "escape";
/** Failures after which part of the action already happened, so the dialog only offers Close. */
const PARTLY_DONE_REASONS = new Set(["branch_not_merged"]);

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
 * The tunnel listens on 127.0.0.1; "localhost" can reach a local server on ::1 with the same port instead.
 * @param {number} localPort
 */
const localUrl = (localPort) => `http://127.0.0.1:${localPort}`;

/** @param {string} message */
const announceSuccess = (message) => notify({ title: `herdwatch: ${message}`, level: "success" });

/**
 * One class serves every copy of the mod: the pill in the tab row, the console pane the pill opens, and the
 * dialog that confirms an action.
 */
export default class Herdwatch extends View {
  /** @param {unknown} _props @param {ModContext} cx */
  init(_props, cx) {
    /** @type {CopyRole} */
    this.role = copyRole();
    if (this.role === "dialog") {
      this.initDialog(cx);
      return;
    }
    new Poller().start(cx);
    if (this.role === "console") this.initConsole(cx);
    else handleCommands(cx, { [TOGGLE_COMMAND]: toggleConsole });
  }

  /** @param {ModContext} cx */
  initDialog(cx) {
    this.focusHandle = cx.focus_handle();
    const pendingId = dialogPendingId();
    const pending = readPendingAction(pendingId);
    /** @type {DialogState} */
    this.dialog = {
      pendingId,
      isRunning: false,
      isFinished: false,
      isEscalated: false,
      failure: null,
      checked: Object.fromEntries((pending?.options ?? []).map((option) => [option.key, option.checked])),
    };
    cx.spawn(async () => this.focusHandle.focus());
  }

  /** @param {ModContext} cx */
  initConsole(cx) {
    this.focusHandle = cx.focus_handle();
    /** @type {number} */
    this.width = DEFAULT_CONSOLE_WIDTH_PX;
    /** @type {ConsoleChoices} */
    this.choices = loadConsoleChoices();
    /** @type {Record<string, string>} */
    this.portNotes = {};
    const refreshSeconds = readMonitorState()?.snapshot?.settings?.pane_refresh;
    const refreshMs = Number.isFinite(refreshSeconds) ? refreshSeconds * MILLISECONDS_PER_SECOND : DEFAULT_CONSOLE_REFRESH_MS;
    cx.timer.every(refreshMs, (timerCx) => timerCx.notify());
    handleCommands(cx, { [FOCUS_COMMAND]: () => this.focusHandle.focus() });
  }

  /** The pending action dies with its dialog, also when Esc or a click closes it. */
  async close() {
    if (this.role === "dialog") clearPendingAction(this.dialog.pendingId);
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

  /** @param {DialogCopy} copy */
  askToConfirm(copy) {
    const pending = storePendingAction(copy);
    if (pending) openConfirmDialog(pending);
  }

  /** @param {string} key @param {string | null} note @param {ModContext | ModAsyncContext} cx */
  setPortNote(key, note, cx) {
    const { [key]: _previous, ...otherNotes } = this.portNotes;
    this.portNotes = note === null ? otherNotes : { ...otherNotes, [key]: note };
    cx.notify();
  }

  /** @param {string} label @param {ListeningPort} port @param {ModContext} cx */
  togglePin(label, port, cx) {
    const key = portNoteKey(label, port.port);
    cx.spawn(async (/** @type {ModAsyncContext} */ asyncCx) => {
      const pinResult = await runAction(port.pinned ? "unpin" : "pin", label, [String(port.port)]);
      this.setPortNote(key, pinResult.ok ? null : pinResult.message, asyncCx);
    });
  }

  /** @param {HostSnapshot} host @param {ListeningPort} port @param {ModContext} cx */
  openPort(host, port, cx) {
    const key = portNoteKey(host.label, port.port);
    const tunnel = tunnelOfPort(runningTunnels(), host.label, port.port);
    if (tunnel) {
      cx.open_url(localUrl(tunnel.localPort));
      return;
    }
    this.setPortNote(key, OPENING_TUNNEL_NOTE, cx);
    cx.spawn(async (/** @type {ModAsyncContext} */ asyncCx) => {
      const started = await startTunnel(host, port.port);
      if (started.ok === true) asyncCx.open_url(localUrl(started.localPort));
      this.setPortNote(key, started.ok === true ? null : started.message, asyncCx);
    });
  }

  /** @param {Tunnel} tunnel @param {ModContext} cx */
  stopTunnelOf(tunnel, cx) {
    cx.spawn(async (/** @type {ModAsyncContext} */ asyncCx) => {
      await stopTunnel(tunnel);
      asyncCx.notify();
    });
  }

  /** @param {HostSnapshot} host @param {ModContext} cx */
  askToPrune(host, cx) {
    cx.spawn(async () => {
      const preview = await runAction("docker-prune", host.label, ["--preview"]);
      if (preview.ok === false) {
        notify({ title: "herdwatch: Docker prune", body: preview.message, level: "warning" });
        return;
      }
      const sizes = { images_kb: Number(preview.data.images_kb) || 0, volumes_kb: Number(preview.data.volumes_kb) || 0 };
      this.askToConfirm(dockerPruneDialog(host, sizes));
    });
  }

  /** @returns {PortActions} */
  portActions() {
    return {
      onTogglePin: (label, port, clickCx) => this.togglePin(label, port, clickCx),
      onOpenPort: (host, port, clickCx) => this.openPort(host, port, clickCx),
      onStopTunnel: (tunnel, clickCx) => this.stopTunnelOf(tunnel, clickCx),
    };
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
      docker: readDocker(),
      tunnels: runningTunnels(),
      portNotes: this.portNotes,
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
      ports: this.portActions(),
      onKill: (killHost, pid) => this.askToConfirm(killDialog(killHost, pid)),
      onDeleteWorktree: (worktreeHost, worktree) => this.askToConfirm(worktreeDialog(worktreeHost, worktree)),
      onDockerContainer: (dockerHost, container, name) => this.askToConfirm(dockerContainerDialog(dockerHost, container, name)),
      onDockerPrune: (pruneHost, clickCx) => this.askToPrune(pruneHost, clickCx),
    };
  }

  /** @param {string} key @param {ModContext} cx */
  toggleDialogOption(key, cx) {
    this.dialog = { ...this.dialog, checked: { ...this.dialog.checked, [key]: !this.dialog.checked[key] } };
    cx.notify();
  }

  /** @param {PendingAction} pending */
  dialogArguments(pending) {
    const tickedFlags = pending.options.filter((option) => this.dialog.checked[option.key]).map((option) => option.flag);
    const escalationFlags = this.dialog.isEscalated && pending.escalation ? [pending.escalation.flag] : [];
    return [...pending.args, ...tickedFlags, ...escalationFlags];
  }

  /** @param {PendingAction} pending @param {ActionResult} result */
  finishDialog(pending, result) {
    if (result.ok === true) {
      announceSuccess(result.message);
      clearPendingAction(pending.id);
      closeThisDialog();
      return;
    }
    this.dialog = {
      ...this.dialog,
      isRunning: false,
      isEscalated: this.dialog.isEscalated || pending.escalation?.reason === result.reason,
      isFinished: PARTLY_DONE_REASONS.has(result.reason),
      failure: { message: result.message, detail: result.detail },
    };
  }

  /** @param {ModContext} cx */
  confirmDialog(cx) {
    if (this.dialog.isRunning || this.dialog.isFinished) return;
    const pending = readPendingAction(this.dialog.pendingId);
    if (!pending) {
      cx.notify();
      return;
    }
    this.dialog = { ...this.dialog, isRunning: true, failure: null };
    cx.notify();
    cx.spawn(async (/** @type {ModAsyncContext} */ asyncCx) => {
      this.finishDialog(pending, await runAction(pending.name, pending.label, this.dialogArguments(pending)));
      asyncCx.notify();
    });
  }

  cancelDialog() {
    clearPendingAction(this.dialog.pendingId);
    closeThisDialog();
  }

  /** @param {KeyEvent} event @param {ModContext} cx */
  handleDialogKey(event, cx) {
    if (event.key === CONFIRM_KEY) this.confirmDialog(cx);
    if (event.key === CANCEL_KEY) this.cancelDialog();
  }

  /** @param {ModContext} cx @returns {DialogView} */
  dialogView(cx) {
    return {
      pending: readPendingAction(this.dialog.pendingId),
      state: this.dialog,
      onToggleOption: (key) => this.toggleDialogOption(key, cx),
      onConfirm: () => this.confirmDialog(cx),
      onCancel: () => this.cancelDialog(),
    };
  }

  /** @param {ModContext} cx */
  renderDialog(cx) {
    return renderConfirmDialog(this.dialogView(cx), MONOSPACE_FONT)
      .track_focus(this.focusHandle)
      .on_key_down((/** @type {KeyEvent} */ event, /** @type {ModContext} */ keyCx) => this.handleDialogKey(event, keyCx));
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
    if (this.role === "dialog") return this.renderDialog(cx);
    if (this.role === "console") return this.renderConsolePane(cx);
    const barView = {
      monitorState: readMonitorState(),
      isConsoleOpen: isConsoleOpenInFocusedTab(),
      shortcut: toggleShortcutLabel(),
      onToggleConsole: toggleConsole,
    };
    return renderBar(barView, /** @type {ThemeColors} */ (theme()), MONOSPACE_FONT);
  }
}
