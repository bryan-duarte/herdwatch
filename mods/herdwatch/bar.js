import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { LEVEL_MARKS, isStale, level, levelColor, percentText } from "./format.js";
import { GRADIENTS, TOKYO_NIGHT } from "./palette.js";
import { meter, text } from "./widgets.js";

/** @typedef {import("./types.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./types.js").MonitorSettings} MonitorSettings */
/** @typedef {import("./types.js").MonitorState} MonitorState */
/** @typedef {import("./types.js").ThemeColors} ThemeColors */
/** @typedef {import("gpui-kit").Color} Color */

/**
 * @typedef {object} BarView
 * @property {MonitorState | null} monitorState
 * @property {boolean} isDetailOpen
 * @property {string | null} shortcut
 * @property {() => void} onToggleDetail
 */

const BAR_METER_CELLS = 4;
const PILL_HEIGHT_PX = 28;
const PILL_RADIUS_PX = 7;
const TOGGLE_ICON_SIZE_PX = 15;
const SEGMENT_DIVIDER = "│";
const DETAIL_OPEN_ICON = "mods/herdwatch/icons/detail-open.svg";
const DETAIL_CLOSED_ICON = "mods/herdwatch/icons/detail-closed.svg";

/**
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 */
function hostSegment(host, settings) {
  const segment = h_flex().flex_none().gap(5).items_center().child(text(host.label, TOKYO_NIGHT.blue).font_semibold());
  if (host.state === "pending") return segment.child(text("…", TOKYO_NIGHT.comment));
  if (host.state === "down") return segment.child(text("✕", TOKYO_NIGHT.red));
  if (host.state === "auth") return segment.child(text("auth", TOKYO_NIGHT.yellow));
  const percentLevel = level(host.cpu_pct, settings);
  return segment
    .child(meter(host.cpu_pct, BAR_METER_CELLS, GRADIENTS.cpu))
    .child(text(`${percentText(host.cpu_pct)}${LEVEL_MARKS[percentLevel]}`, levelColor(percentLevel)))
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
  const action = view.isDetailOpen ? "Hide host details" : "Show host details";
  return view.shortcut ? `${action} (${view.shortcut})` : action;
}

/**
 * @param {BarView} view
 * @param {ThemeColors} colors
 * @param {string} monospaceFont
 */
export function renderBar(view, colors, monospaceFont) {
  const restingBorder = view.isDetailOpen ? TOKYO_NIGHT.blue : TOKYO_NIGHT.highlight;
  const toggleIcon = svg(view.isDetailOpen ? DETAIL_OPEN_ICON : DETAIL_CLOSED_ICON).size(TOGGLE_ICON_SIZE_PX).flex_none()
    .text_color(view.isDetailOpen ? TOKYO_NIGHT.blue : TOKYO_NIGHT.dim);
  const pill = h_flex().id("herdwatch-pill").h(PILL_HEIGHT_PX).pl(10).pr(8).gap(10).items_center().min_w(0).overflow_hidden()
    .rounded(PILL_RADIUS_PX).bg(TOKYO_NIGHT.backgroundDark).border_1().border_color(restingBorder)
    .cursor_pointer().tooltip(toggleTooltip(view))
    .hover((style) => style.bg(TOKYO_NIGHT.highlight).border_color(TOKYO_NIGHT.blue))
    .active((style) => style.bg(TOKYO_NIGHT.border))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      view.onToggleDetail();
    })
    .children(pillContent(view.monitorState))
    .child(text(SEGMENT_DIVIDER, TOKYO_NIGHT.border))
    .child(toggleIcon);
  return h_flex().id("herdwatch-bar").size_full().min_w(0).pr(10).items_center().justify_end()
    .bg(colors.chrome).border_b(1).border_color(colors.border)
    .font_family(monospaceFont).text_size(11.5)
    .child(div().min_w(0).child(pill));
}
