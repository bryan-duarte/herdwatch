import { focused, keys, panes, props, run, window as herdrWindow } from "herdr";
import { MOD_NAME, TOGGLE_COMMAND } from "./mod.js";

const CONSOLE_PANE_VIEW = "detail"; // saved layouts keep this value in open panes; a new value turns those panes into pills
/** @type {Record<string, string>} */
const MAC_KEY_SYMBOLS = { cmd: "⌘", ctrl: "⌃", shift: "⇧", alt: "⌥", option: "⌥" };

export const isConsoleCopy = () => props()?.view === CONSOLE_PANE_VIEW;

/** @param {string | undefined} tab */
const consolePaneIn = (tab) => panes().find((pane) => pane.mod === MOD_NAME && pane.tab === tab);

export const isConsoleOpenInFocusedTab = () => Boolean(consolePaneIn(focused()?.tab));

export function closeConsole() {
  const openConsole = consolePaneIn(focused()?.tab);
  if (openConsole) run("pane.close", { pane: openConsole.pane });
}

/**
 * Opens the console to the right of the focused pane and gives the focus back to that pane, or closes the open console.
 */
export function toggleConsole() {
  const current = focused();
  if (!current?.tab) return;
  const openConsole = consolePaneIn(current.tab);
  if (openConsole) {
    run("pane.close", { pane: openConsole.pane });
    return;
  }
  const previousPane = current.pane;
  run("pane.split", { direction: "right", mod: MOD_NAME, props: { view: CONSOLE_PANE_VIEW }, ...(previousPane ? { pane: previousPane } : {}) });
  if (previousPane) run("pane.focus", { pane: previousPane });
}

/** @param {string} keyName @param {boolean} isMac */
const keyLabel = (keyName, isMac) => (isMac ? MAC_KEY_SYMBOLS[keyName] : null) ?? keyName.toUpperCase();

/** @returns {string | null} */
export function toggleShortcutLabel() {
  const binding = keys().find((key) => key.action === `${MOD_NAME}.${TOGGLE_COMMAND}`);
  if (!binding) return null;
  const isMac = herdrWindow()?.platform === "macos";
  return binding.keys.split("-").map((keyName) => keyLabel(keyName, isMac)).join(isMac ? "" : "+");
}
