import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { ageSince, minutesIn, minutesText, nowInSeconds } from "../format.js";
import { hostHealth } from "../health.js";
import { CHART_RANGE_SAMPLES, SECONDS_PER_SAMPLE } from "../history.js";
import { TOKYO_NIGHT, healthColor } from "../palette.js";
import { worktreesOfHost } from "../worktrees.js";
import { agentsPanel } from "./agents-panel.js";
import { portsPanel } from "./ports-panel.js";
import { processesPanel } from "./processes-panel.js";
import { systemPanel } from "./system-panel.js";
import { worktreesPanel } from "./worktrees-panel.js";
import { AGENT_MARKER, hostTitle, iconButton, keycap, panel, segmentedControl, tabStrip, text } from "./widgets.js";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("../schemas.js").ConsoleTab} ConsoleTab */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").Element} Element */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */

const HEADER_HEIGHT_PX = 40;
const FOOTER_HEIGHT_PX = 30;
const CONSOLE_TEXT_SIZE_PX = 12;
const CLOSE_ICON = "mods/herdwatch/icons/close.svg";
const RANGE_OPTIONS = CHART_RANGE_SAMPLES.map((samples) => {
  const rangeSeconds = samples * SECONDS_PER_SAMPLE;
  return { value: String(samples), label: minutesText(rangeSeconds), tooltip: `Show the last ${minutesIn(rangeSeconds)} minutes` };
});

/** @param {ConsoleView} view */
function header(view) {
  const snapshot = view.monitorState?.snapshot;
  const hosts = snapshot?.hosts ?? [];
  const hostOptions = hosts.map((host, index) => ({
    value: host.label,
    label: host.label,
    tooltip: `Show ${host.label} (${index + 1})`,
    dotColor: snapshot ? healthColor(hostHealth(host, snapshot.settings)) : null,
  }));
  const hasHostTabs = hosts.length > 0 && Boolean(view.host);
  return h_flex().h(HEADER_HEIGHT_PX).flex_none().px(10).gap(8).items_center().min_w(0).bg(TOKYO_NIGHT.backgroundDark).border_b(1).border_color(TOKYO_NIGHT.highlight)
    .child(text("herdwatch", TOKYO_NIGHT.foreground).font_semibold())
    .when(hasHostTabs, (element) => element.child(tabStrip({ id: "hosts", options: hostOptions, selected: view.host.label, onSelect: view.onHost })))
    .child(div().flex_1())
    .child(segmentedControl({ id: "range", options: RANGE_OPTIONS, selected: String(view.rangeSamples), onSelect: (samples) => view.onRange(Number(samples)) }))
    .child(iconButton({
      id: "close-console",
      icon: CLOSE_ICON,
      hoverColor: TOKYO_NIGHT.red,
      onPress: view.onClose,
      tooltip: view.shortcut ? `Close Herdwatch (${view.shortcut})` : "Close Herdwatch",
    }));
}

/** @param {ConsoleView} view */
function consoleTabs(view) {
  const { host } = view;
  /** @type {{ value: ConsoleTab, label: string, count?: number | null, tooltip: string }[]} */
  const options = [
    { value: "overview", label: "overview", tooltip: "Charts and totals" },
    { value: "agents", label: "agents", count: host?.agents.length ?? 0, tooltip: "Coding agent sessions on this host" },
    { value: "ports", label: "ports", count: host?.ports.length ?? 0, tooltip: "Listening ports and the agent that owns each" },
    { value: "worktrees", label: "worktrees", count: host ? worktreesOfHost(view.worktrees, host).items.length : 0, tooltip: "Git worktrees, size and health" },
    { value: "procs", label: "procs", count: view.monitorState?.snapshot?.settings.top_n ?? null, tooltip: "Top processes" },
  ];
  return div().px(10).py(6).flex_none().bg(TOKYO_NIGHT.backgroundDark).border_b(1).border_color(TOKYO_NIGHT.highlight)
    .child(tabStrip({ id: "console-tabs", options, selected: view.tab, onSelect: view.onTab }));
}

/** @param {string} key @param {string} action @param {boolean} isLive */
const keyHint = (key, action, isLive) => [keycap(key, isLive), text(action, TOKYO_NIGHT.comment)];

/** @param {ConsoleView} view */
function footer(view) {
  const keysHint = view.hasKeyboard ? "keys on" : "click the pane for keys";
  return h_flex().h(FOOTER_HEIGHT_PX).flex_none().px(10).gap(8).items_center().overflow_hidden().text_size(11)
    .bg(TOKYO_NIGHT.backgroundDark).border_t(1).border_color(TOKYO_NIGHT.highlight)
    .child(text(AGENT_MARKER, TOKYO_NIGHT.green)).child(text("agent", TOKYO_NIGHT.comment))
    .child(text("│", TOKYO_NIGHT.border))
    .children(keyHint("c", "cpu", view.hasKeyboard))
    .children(keyHint("m", "mem", view.hasKeyboard))
    .children(keyHint("1-4", "host", view.hasKeyboard))
    .when(Boolean(view.shortcut), (element) => element.children(keyHint(view.shortcut, "toggle", true)))
    .child(div().flex_1().min_w(0).truncate().text_right().text_color(view.hasKeyboard ? TOKYO_NIGHT.blue : TOKYO_NIGHT.comment).child(keysHint));
}

/**
 * @param {ConsoleView} view
 * @returns {{ color: Color, message: string } | null}
 */
function notice(view) {
  const snapshot = view.monitorState?.snapshot;
  if (view.monitorState?.error) return { color: TOKYO_NIGHT.red, message: `Backend error: ${view.monitorState.error}` };
  if (!snapshot) return { color: TOKYO_NIGHT.yellow, message: "Waiting for the first poll of your hosts." };
  if (!snapshot.hosts.length) return { color: TOKYO_NIGHT.dim, message: `No hosts. Add "label  ssh-target" lines to ${snapshot.hosts_file}` };
  const isPollLate = nowInSeconds() - snapshot.generated_at > snapshot.settings.stale_seconds;
  if (isPollLate) return { color: TOKYO_NIGHT.yellow, message: `No fresh data since ${ageSince(snapshot.generated_at)}. The next poll is late.` };
  return null;
}

/** @param {{ color: Color, message: string }} banner */
const noticePanel = (banner) => panel({
  id: "herdwatch-notice",
  title: text("notice", banner.color),
  borderColor: banner.color,
  body: [div().text_color(banner.color).child(banner.message)],
});

/** @param {HostSnapshot} host @param {number} hostNumber */
function unreachablePanel(host, hostNumber) {
  const isLoginRefused = host.state === "auth";
  const color = isLoginRefused ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.red;
  return panel({
    id: `state-${host.label}`,
    title: hostTitle(host.label, hostNumber, color),
    rightTitle: text(isLoginRefused ? "login needed" : "down", color),
    borderColor: color,
    body: [
      text(`✕ ${isLoginRefused ? "login refused" : "no answer"} · values below are from ${ageSince(host.updated_at)}`, color),
      div().text_color(TOKYO_NIGHT.comment).child(host.error || "no error text"),
    ],
  });
}

/** @param {HostSnapshot} host @param {number} hostNumber */
const waitingPanel = (host, hostNumber) => panel({
  id: `state-${host.label}`,
  title: hostTitle(host.label, hostNumber, TOKYO_NIGHT.blue),
  body: [text("… waiting for the first poll", TOKYO_NIGHT.comment)],
});

/**
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 * @param {number} hostNumber
 * @param {MonitorSettings} settings
 * @returns {Element[]}
 */
function tabPanels(view, host, hostNumber, settings) {
  if (view.tab === "agents") return [agentsPanel(view, host, settings)];
  if (view.tab === "ports") return [portsPanel(view, host)];
  if (view.tab === "worktrees") return [worktreesPanel(view, host, settings)];
  if (view.tab === "procs") return processesPanel(view, host, settings);
  return [systemPanel(view, host, hostNumber, settings), agentsPanel(view, host, settings)];
}

/**
 * A host that does not answer keeps its last values, under a box that says so.
 * @param {ConsoleView} view
 * @returns {Element[]}
 */
function tabBody(view) {
  const snapshot = view.monitorState?.snapshot;
  const { host } = view;
  if (!snapshot || !host) return [];
  const hostNumber = snapshot.hosts.indexOf(host) + 1;
  if (host.state === "pending") return [waitingPanel(host, hostNumber)];
  const unreachableNote = host.state === "ok" ? [] : [unreachablePanel(host, hostNumber)];
  return [...unreachableNote, ...tabPanels(view, host, hostNumber, snapshot.settings)];
}

/**
 * The tabbed console: host tabs and range in the header, a tab strip, one tab body, and the key footer.
 * @param {ConsoleView} view
 * @param {string} monospaceFont
 */
export function renderConsole(view, monospaceFont) {
  const banner = notice(view);
  const body = v_flex().id(`console-body-${view.tab}`).flex_1().min_h(0).px(10).pt(8).pb(12).gap(12)
    .when(view.tab !== "worktrees", (element) => element.overflow_y_scrollbar())
    .when(Boolean(banner), (element) => element.child(noticePanel(banner)))
    .children(tabBody(view));
  return v_flex().id("herdwatch-console").size_full().bg(TOKYO_NIGHT.background).font_family(monospaceFont).text_size(CONSOLE_TEXT_SIZE_PX).text_color(TOKYO_NIGHT.foreground)
    .child(header(view))
    .child(consoleTabs(view))
    .child(body)
    .child(footer(view));
}
