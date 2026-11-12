import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { dockerOfHost } from "../docker.js";
import { backendGuidance, configProblemLine, downForText, hostFailureGuidance, hostProblemGuidance, hostTabTooltip } from "../failure-guidance.js";
import { ageSince, minutesIn, minutesText, nowInSeconds } from "../format.js";
import { hostHealth, isPollLate } from "../health.js";
import { CHART_RANGE_SAMPLES, SECONDS_PER_SAMPLE } from "../history.js";
import { TOKYO_NIGHT, healthColor } from "../palette.js";
import { worktreesOfHost } from "../worktrees.js";
import { agentsPanel } from "./agents-panel.js";
import { dockerPanel } from "./docker-panel.js";
import { portsPanel } from "./ports-panel.js";
import { processesPanel } from "./processes-panel.js";
import { systemPanel } from "./system-panel.js";
import { worktreesPanel } from "./worktrees-panel.js";
import { AGENT_MARKER, hostTitle, iconButton, keycap, panel, segmentedControl, tabStrip, text, titleRow, uiIcon } from "./widgets.js";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("../schemas.js").ConsoleTab} ConsoleTab */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").Element} Element */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("../schemas.js").Snapshot} Snapshot */

/**
 * @typedef {object} Notice
 * @property {Color} color
 * @property {string[]} lines
 */

const HEADER_HEIGHT_PX = 40;
const FOOTER_HEIGHT_PX = 30;
const CONSOLE_TEXT_SIZE_PX = 12;
const CLOSE_ICON = "mods/herdwatch/icons/close.svg";
const TABS_WITHOUT_OUTER_SCROLL = new Set(["worktrees", "docker"]);
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
    tooltip: hostTabTooltip(host, index, snapshot.settings),
    dotColor: snapshot ? healthColor(hostHealth(host, snapshot.settings)) : null,
  }));
  const hasHostTabs = hosts.length > 0 && Boolean(view.host);
  return h_flex().h(HEADER_HEIGHT_PX).flex_none().px(10).gap(8).items_center().min_w(0).bg(TOKYO_NIGHT.backgroundDark).border_b(1).border_color(TOKYO_NIGHT.highlight)
    .child(text("herdwatch", TOKYO_NIGHT.foreground).font_semibold())
    .when(hasHostTabs, (element) => element.child(tabStrip({ id: "hosts", options: hostOptions, selected: view.host.label, onSelect: view.onHost })))
    .child(div().flex_1())
    .child(uiIcon("history").text_color(TOKYO_NIGHT.comment))
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
  /** @type {import("./widgets.js").ChoiceOption<ConsoleTab>[]} */
  const options = [
    { value: "overview", label: "overview", glyph: "gauge", tooltip: "Charts and totals" },
    { value: "agents", label: "agents", glyph: "bot", count: host?.agents.length ?? 0, tooltip: "Coding agent sessions on this host" },
    { value: "ports", label: "ports", glyph: "plug", count: host?.ports.length ?? 0, tooltip: "Listening ports and the agent that owns each" },
    { value: "worktrees", label: "worktrees", glyph: "folder-git-2", count: host ? worktreesOfHost(view.worktrees, host).items.length : 0, tooltip: "Git worktrees, size and health" },
    { value: "docker", label: "docker", glyph: "container", count: host ? dockerOfHost(view.docker, host).containers.length : null, tooltip: "Containers, images and volumes" },
    { value: "procs", label: "procs", glyph: "activity", count: view.monitorState?.snapshot?.settings.top_n ?? null, tooltip: "Top processes" },
  ];
  return div().px(10).py(6).flex_none().bg(TOKYO_NIGHT.backgroundDark).border_b(1).border_color(TOKYO_NIGHT.highlight)
    .child(tabStrip({ id: "console-tabs", options, selected: view.tab, onSelect: view.onTab, compact: !view.isWide }));
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
    .child(h_flex().flex_1().min_w(0).justify_end().gap(5).items_center().text_color(view.hasKeyboard ? TOKYO_NIGHT.blue : TOKYO_NIGHT.comment)
      .child(uiIcon("keyboard")).child(div().min_w(0).truncate().child(keysHint)));
}

/** @param {Snapshot} snapshot */
function lateLine(snapshot) {
  if (!isPollLate(snapshot, nowInSeconds())) return null;
  const isPreviousPollBusy = snapshot.collector.state === "busy";
  const reason = isPreviousPollBusy ? " The previous poll still runs: a host answers slowly." : " The next poll is late.";
  return `No fresh data since ${ageSince(snapshot.generated_at)}.${reason}`;
}

/**
 * @param {ConsoleView} view
 * @returns {Notice | null}
 */
function notice(view) {
  const snapshot = view.monitorState?.snapshot;
  const failure = view.monitorState?.error;
  if (failure) {
    const { summary, nextStep } = backendGuidance(failure);
    return { color: TOKYO_NIGHT.red, lines: [summary, ...(failure.detail ? [failure.detail] : []), `Next: ${nextStep}`] };
  }
  if (!snapshot) return { color: TOKYO_NIGHT.yellow, lines: ["Waiting for the first poll of your hosts."] };
  const problemLines = snapshot.problems.map((problem) => configProblemLine(problem, snapshot.settings));
  const latePollLine = lateLine(snapshot);
  const warningLines = [...(latePollLine ? [latePollLine] : []), ...problemLines];
  if (!snapshot.hosts.length) {
    return { color: TOKYO_NIGHT.dim, lines: [`No hosts. Add "label  ssh-target" lines to ${snapshot.hosts_file}`, ...warningLines] };
  }
  return warningLines.length ? { color: TOKYO_NIGHT.yellow, lines: warningLines } : null;
}

/** @param {Notice} banner */
const noticePanel = (banner) => panel({
  id: "herdwatch-notice",
  title: titleRow(uiIcon("triangle-alert").text_color(banner.color), text("notice", banner.color)),
  borderColor: banner.color,
  body: banner.lines.map((line) => div().text_color(banner.color).child(line)),
});

/** @param {HostSnapshot} host @param {number} hostNumber @param {MonitorSettings} settings */
function unreachablePanel(host, hostNumber, settings) {
  const isLoginRefused = host.state === "auth";
  const color = isLoginRefused ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.red;
  const { summary, nextStep } = hostFailureGuidance(host, settings);
  return panel({
    id: `state-${host.label}`,
    title: hostTitle(host.label, hostNumber, color),
    rightTitle: text(`${isLoginRefused ? "login needed" : "down"}${downForText(host)}`, color),
    borderColor: color,
    body: [
      text(`✕ ${summary}`, color),
      ...(host.detail ? [div().text_color(TOKYO_NIGHT.comment).child(`ssh: ${host.detail}`)] : []),
      div().text_color(TOKYO_NIGHT.foregroundDark).child(`Next: ${nextStep}`),
      text(`Values below are from ${ageSince(host.updated_at)}.`, TOKYO_NIGHT.comment),
    ],
  });
}

/** @param {HostSnapshot} host */
function hostNotesPanel(host) {
  const lines = host.problems.map(hostProblemGuidance).map(({ summary, nextStep }) => `${summary} ${nextStep}`);
  return panel({
    id: `notes-${host.label}`,
    title: titleRow(uiIcon("triangle-alert").text_color(TOKYO_NIGHT.yellow), text("host notes", TOKYO_NIGHT.yellow)),
    borderColor: TOKYO_NIGHT.yellow,
    body: lines.map((line) => div().text_color(TOKYO_NIGHT.yellow).child(line)),
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
  if (view.tab === "docker") return [dockerPanel(view, host, settings)];
  return [systemPanel(view, host, hostNumber, settings), agentsPanel(view, host, settings, { showSparklines: false })];
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
  const unreachableNote = host.state === "ok" ? [] : [unreachablePanel(host, hostNumber, snapshot.settings)];
  const hostNotes = host.problems.length ? [hostNotesPanel(host)] : [];
  return [...unreachableNote, ...hostNotes, ...tabPanels(view, host, hostNumber, snapshot.settings)];
}

/**
 * The tabbed console: host tabs and range in the header, a tab strip, one tab body, and the key footer.
 * @param {ConsoleView} view
 * @param {string} monospaceFont
 */
export function renderConsole(view, monospaceFont) {
  const banner = notice(view);
  const body = v_flex().id(`console-body-${view.tab}`).flex_1().min_h(0).px(10).pt(8).pb(12).gap(12)
    .when(!TABS_WITHOUT_OUTER_SCROLL.has(view.tab), (element) => element.overflow_y_scrollbar())
    .when(Boolean(banner), (element) => element.child(noticePanel(banner)))
    .children(tabBody(view));
  return v_flex().id("herdwatch-console").size_full().bg(TOKYO_NIGHT.background).font_family(monospaceFont).text_size(CONSOLE_TEXT_SIZE_PX).text_color(TOKYO_NIGHT.foreground)
    .child(header(view))
    .child(consoleTabs(view))
    .child(body)
    .child(footer(view));
}
