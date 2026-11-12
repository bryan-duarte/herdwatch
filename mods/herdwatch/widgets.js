import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { TOKYO_NIGHT, gradientAt } from "./palette.js";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("./types.js").Element} Element */

const PERCENT_SCALE = 100;
const METER_CELL_WIDTH_PX = 5;
const METER_CELL_HEIGHT_PX = 11;
const METER_CELL_GAP_PX = 2;
const BOX_RADIUS_PX = 8;
const EDGE_ROW_HEIGHT_PX = 18;
const EDGE_MIDDLE_PX = EDGE_ROW_HEIGHT_PX / 2;
const EDGE_CORNER_WIDTH_PX = 10;
const EDGE_CAP_WIDTH_PX = 4;
const EDGE_MIN_LINE_WIDTH_PX = 8;
const CONTROL_HEIGHT_PX = 22;
const CONTROL_RADIUS_PX = 5;
const ICON_BUTTON_SIZE_PX = 24;
const ICON_SIZE_PX = 14;
const SUPERSCRIPT_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

/** @param {number} index */
export const superscript = (index) => String(index).split("").map((digit) => SUPERSCRIPT_DIGITS[Number(digit)]).join("");

/** @param {string} content @param {Color} color */
export const text = (content, color) => div().flex_none().text_color(color).child(content);

/**
 * A btop meter: a row of cells, filled up to the percent, each filled cell colored by its place on the gradient.
 * @param {number | null} percent
 * @param {number} cellCount
 * @param {readonly Color[]} gradient
 */
export function meter(percent, cellCount, gradient) {
  const filledCells = Number.isFinite(percent) && percent > 0
    ? Math.max(1, Math.round((Math.min(percent, PERCENT_SCALE) / PERCENT_SCALE) * cellCount))
    : 0;
  const cells = Array.from({ length: cellCount }, (_unused, index) =>
    div().w(METER_CELL_WIDTH_PX).h(METER_CELL_HEIGHT_PX).flex_none().rounded(1)
      .bg(index < filledCells ? gradientAt(gradient, cellCount > 1 ? index / (cellCount - 1) : 0) : TOKYO_NIGHT.highlight));
  return h_flex().flex_none().gap(METER_CELL_GAP_PX).items_center().children(cells);
}

/** @param {Color} color */
const edgeLine = (color) => div().flex_1().min_w(EDGE_MIN_LINE_WIDTH_PX).h(1).mt(EDGE_MIDDLE_PX).bg(color);

/** @param {Color} color */
const edgeCap = (color) => div().w(EDGE_CAP_WIDTH_PX).flex_none().h(1).mt(EDGE_MIDDLE_PX).bg(color);

/** @param {"left" | "right"} side @param {Color} color */
function edgeCorner(side, color) {
  const corner = div().w(EDGE_CORNER_WIDTH_PX).h(EDGE_MIDDLE_PX).flex_none().mt(EDGE_MIDDLE_PX).border_t(1).border_color(color);
  return side === "left" ? corner.border_l(1).rounded_tl(BOX_RADIUS_PX) : corner.border_r(1).rounded_tr(BOX_RADIUS_PX);
}

/** @param {Element} content */
const edgeTitle = (content) => h_flex().h(EDGE_ROW_HEIGHT_PX).flex_none().px(6).items_center().child(content);

/**
 * A btop box: a rounded border with the title (and an optional right title) in the top edge.
 * The top edge is built from elements in the normal flow, so the titles stay clickable and nothing draws over them.
 * With fill, the box and its body take all the free height of a column parent.
 * @param {{ id: string, title: Element, rightTitle?: Element | null, borderColor?: Color, body: Element[], fill?: boolean }} options
 */
export function panel({ id, title, rightTitle = null, borderColor = TOKYO_NIGHT.border, body, fill = false }) {
  const topEdge = h_flex().w_full().h(EDGE_ROW_HEIGHT_PX).items_start()
    .child(edgeCorner("left", borderColor))
    .child(edgeCap(borderColor))
    .child(edgeTitle(title))
    .child(edgeLine(borderColor))
    .when(Boolean(rightTitle), (element) => element.child(edgeTitle(rightTitle)).child(edgeCap(borderColor)))
    .child(edgeCorner("right", borderColor));
  const content = v_flex().px(14).pt(6).pb(12).gap(8)
    .border_l(1).border_r(1).border_b(1).border_color(borderColor).rounded_bl(BOX_RADIUS_PX).rounded_br(BOX_RADIUS_PX)
    .when(fill, (element) => element.flex_1().min_h(0))
    .children(body);
  return v_flex().id(id).when(fill, (element) => element.flex_1().min_h(0)).child(topEdge).child(content);
}

/** @param {string} label @param {Color} color */
export function chip(label, color) {
  return div().flex_none().px(5).rounded(3).bg(TOKYO_NIGHT.highlight).text_color(color).child(label);
}

/** @param {...Element} parts */
export const titleRow = (...parts) => h_flex().gap(6).items_center().children(parts);

/**
 * A key hint drawn as a keycap. It turns blue while the keys work (the pane has the keyboard).
 * @param {string} label
 * @param {boolean} isLive
 */
export function keycap(label, isLive) {
  return div().flex_none().h(16).min_w(16).px(4).flex().items_center().justify_center().rounded(3).border_1()
    .border_color(isLive ? TOKYO_NIGHT.blue : TOKYO_NIGHT.border)
    .bg(isLive ? TOKYO_NIGHT.highlight : TOKYO_NIGHT.backgroundDark)
    .text_size(10.5).text_color(isLive ? TOKYO_NIGHT.blue : TOKYO_NIGHT.dim)
    .child(label);
}

/**
 * A segmented control. The chosen option is filled blue; the others are framed buttons with hover and press states.
 * @template {string} Value
 * @param {{ id: string, options: { value: Value, label: string, tooltip: string }[], selected: Value, onSelect: (value: Value) => void }} control
 */
export function segmentedControl({ id, options, selected, onSelect }) {
  const segments = options.map((option) => {
    const isSelected = option.value === selected;
    const segment = div().id(`${id}-${option.value}`).h(CONTROL_HEIGHT_PX - 4).px(9).flex().items_center().rounded(CONTROL_RADIUS_PX - 2)
      .text_size(11).font_semibold().cursor_pointer().tooltip(option.tooltip)
      .on_click((_event, cx) => {
        cx.stop_propagation();
        onSelect(option.value);
      })
      .child(option.label);
    if (isSelected) return segment.bg(TOKYO_NIGHT.blue).text_color(TOKYO_NIGHT.background);
    return segment.text_color(TOKYO_NIGHT.dim)
      .hover((style) => style.bg(TOKYO_NIGHT.highlight).text_color(TOKYO_NIGHT.foreground))
      .active((style) => style.bg(TOKYO_NIGHT.border));
  });
  return h_flex().id(id).h(CONTROL_HEIGHT_PX).p(2).gap(2).items_center().rounded(CONTROL_RADIUS_PX)
    .border_1().border_color(TOKYO_NIGHT.border).bg(TOKYO_NIGHT.backgroundDark).children(segments);
}

/**
 * A square icon button with hover, press and tooltip.
 * @param {{ id: string, icon: string, tooltip: string, hoverColor?: Color, onPress: () => void }} button
 */
export function iconButton({ id, icon, tooltip, hoverColor = TOKYO_NIGHT.foreground, onPress }) {
  return div().id(id).size(ICON_BUTTON_SIZE_PX).flex_none().flex().items_center().justify_center().rounded(CONTROL_RADIUS_PX)
    .border_1().border_color(TOKYO_NIGHT.border).text_color(TOKYO_NIGHT.dim).cursor_pointer().tooltip(tooltip)
    .hover((style) => style.bg(TOKYO_NIGHT.highlight).text_color(hoverColor).border_color(hoverColor))
    .active((style) => style.bg(TOKYO_NIGHT.border))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onPress();
    })
    .child(svg(icon).size(ICON_SIZE_PX));
}

/**
 * @template {string} Value
 * @typedef {object} TabOption
 * @property {Value} value
 * @property {string} label
 * @property {number | null} [count]
 * @property {string} tooltip
 * @property {Color | null} [dotColor]
 */

/**
 * A row of tabs. The open tab is framed and filled; the others show hover and press states.
 * @template {string} Value
 * @param {{ id: string, options: TabOption<Value>[], selected: Value, onSelect: (value: Value) => void }} strip
 */
export function tabStrip({ id, options, selected, onSelect }) {
  const tabs = options.map((option) => {
    const isSelected = option.value === selected;
    const tab = h_flex().id(`${id}-${option.value}`).h(22).px(9).gap(6).flex_none().items_center().rounded(5).border_1()
      .text_size(11.5).cursor_pointer().tooltip(option.tooltip)
      .on_click((_event, cx) => {
        cx.stop_propagation();
        onSelect(option.value);
      })
      .when(Boolean(option.dotColor), (element) => element.child(div().size(7).rounded(4).flex_none().bg(option.dotColor)))
      .child(option.label)
      .when(Number.isFinite(option.count), (element) => element.child(div().text_size(10.5).text_color(TOKYO_NIGHT.comment).child(String(option.count))));
    if (isSelected) return tab.border_color(TOKYO_NIGHT.border).bg(TOKYO_NIGHT.highlight).text_color(TOKYO_NIGHT.foreground);
    return tab.border_color(TOKYO_NIGHT.backgroundDark).text_color(TOKYO_NIGHT.dim)
      .hover((style) => style.bg(TOKYO_NIGHT.highlight).text_color(TOKYO_NIGHT.foreground))
      .active((style) => style.bg(TOKYO_NIGHT.border));
  });
  return h_flex().id(id).gap(2).min_w(0).items_center().overflow_x_scrollbar().children(tabs);
}

/**
 * Filter chips: pill buttons with a count; the chosen one is filled blue.
 * @template {string} Value
 * @param {{ id: string, options: TabOption<Value>[], selected: Value, onSelect: (value: Value) => void }} chips
 */
export function filterChips({ id, options, selected, onSelect }) {
  return h_flex().id(id).gap(4).flex_wrap().children(options.map((option) => {
    const isSelected = option.value === selected;
    const chipButton = h_flex().id(`${id}-${option.value}`).h(20).px(8).gap(5).items_center().rounded(10).border_1().text_size(11)
      .cursor_pointer().tooltip(option.tooltip)
      .on_click((_event, cx) => {
        cx.stop_propagation();
        onSelect(option.value);
      })
      .child(option.label)
      .when(Number.isFinite(option.count), (element) => element.child(String(option.count)));
    if (isSelected) return chipButton.bg(TOKYO_NIGHT.blue).border_color(TOKYO_NIGHT.blue).text_color(TOKYO_NIGHT.background);
    return chipButton.bg(TOKYO_NIGHT.backgroundDark).border_color(TOKYO_NIGHT.border).text_color(TOKYO_NIGHT.dim)
      .hover((style) => style.bg(TOKYO_NIGHT.highlight).text_color(TOKYO_NIGHT.foreground))
      .active((style) => style.bg(TOKYO_NIGHT.border));
  }));
}
