import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { percentText } from "../format.js";
import { isStale, percentLevel } from "../health.js";
import { GRADIENTS, TOKYO_NIGHT, levelColor } from "../palette.js";
import { meter, pressable, text } from "./widgets.js";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("../schemas.js").BarView} BarView */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("../schemas.js").MonitorState} MonitorState */
/** @typedef {import("../schemas.js").PercentLevel} PercentLevel */
/** @typedef {import("../schemas.js").ThemeColors} ThemeColors */

const BAR_METER_CELLS = 4;
const PILL_HEIGHT_PX = 28;
const PILL_RADIUS_PX = 7;
const BAR_TEXT_SIZE_PX = 11.5;
const TOGGLE_ICON_SIZE_PX = 15;
const SEGMENT_DIVIDER = "│";
const CONSOLE_OPEN_ICON = "mods/herdwatch/icons/console-open.svg";
const CONSOLE_CLOSED_ICON = "mods/herdwatch/icons/console-closed.svg";
/** @type {Record<PercentLevel, string>} */
const LEVEL_MARKS = { critical: "!!", warning: "!", normal: "" };
/** @type {Record<Exclude<HostSnapshot["state"], "ok">, { mark: string, color: Color }>} */
const UNREACHABLE_MARKS = {
  pending: { mark: "…", color: TOKYO_NIGHT.comment },
  down: { mark: "✕", color: TOKYO_NIGHT.red },
  auth: { mark: "auth", color: TOKYO_NIGHT.yellow },
};

/**
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 */
function hostSegment(host, settings) {
  const segment = h_flex().flex_none().gap(5).items_center().child(text(host.label, TOKYO_NIGHT.blue).font_semibold());
  if (host.state !== "ok") {
    const { mark, color } = UNREACHABLE_MARKS[host.state];
    return segment.child(text(mark, color));
  }
  const cpuLevel = percentLevel(host.cpu_pct, settings);
  return segment
    .child(meter(host.cpu_pct, BAR_METER_CELLS, GRADIENTS.cpu))
    .child(text(`${percentText(host.cpu_pct)}${LEVEL_MARKS[cpuLevel]}`, levelColor(cpuLevel)))
    .when(isStale(host, settings), (element) => element.child(text("?", TOKYO_NIGHT.comment)));
}

/** @param {MonitorState | null} monitorState */
function pillContent(monitorState) {
  const snapshot = monitorState?.snapshot;
  if (monitorState?.error && !snapshot) return [text("herdwatch: error", TOKYO_NIGHT.red)];
  if (!snapshot) return [text("herdwatch …", TOKYO_NIGHT.comment)];
  if (snapshot.hosts.length === 0) return [text("herdwatch: add hosts", TOKYO_NIGHT.dim)];
  return snapshot.hosts.flatMap((host, index) => [
    ...(index > 0 ? [text(SEGMENT_DIVIDER, TOKYO_NIGHT.border)] : []),
    hostSegment(host, snapshot.settings),
  ]);
}

/** @param {BarView} view */
function toggleTooltip(view) {
  const action = view.isConsoleOpen ? "Hide host details" : "Show host details";
  return view.shortcut ? `${action} (${view.shortcut})` : action;
}

/** @param {BarView} view */
function pill(view) {
  const accent = view.isConsoleOpen ? TOKYO_NIGHT.blue : TOKYO_NIGHT.dim;
  const toggleIcon = svg(view.isConsoleOpen ? CONSOLE_OPEN_ICON : CONSOLE_CLOSED_ICON).size(TOGGLE_ICON_SIZE_PX).flex_none().text_color(accent);
  const frame = h_flex().id("herdwatch-pill").h(PILL_HEIGHT_PX).pl(10).pr(8).gap(10).items_center().min_w(0).overflow_hidden()
    .rounded(PILL_RADIUS_PX).bg(TOKYO_NIGHT.backgroundDark).border_1()
    .border_color(view.isConsoleOpen ? TOKYO_NIGHT.blue : TOKYO_NIGHT.highlight)
    .hover((style) => style.bg(TOKYO_NIGHT.highlight).border_color(TOKYO_NIGHT.blue))
    .active((style) => style.bg(TOKYO_NIGHT.border))
    .children(pillContent(view.monitorState))
    .child(text(SEGMENT_DIVIDER, TOKYO_NIGHT.border))
    .child(toggleIcon);
  return pressable(frame, toggleTooltip(view), view.onToggleConsole);
}

/**
 * The pill in the tab row: one segment per host, and a button that opens or closes the console.
 * @param {BarView} view
 * @param {ThemeColors} colors
 * @param {string} monospaceFont
 */
export function renderBar(view, colors, monospaceFont) {
  return h_flex().id("herdwatch-bar").size_full().min_w(0).pr(10).items_center().justify_end()
    .bg(colors.chrome).border_b(1).border_color(colors.border)
    .font_family(monospaceFont).text_size(BAR_TEXT_SIZE_PX)
    .child(div().min_w(0).child(pill(view)));
}
