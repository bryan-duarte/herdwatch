import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agentMark } from "../agent-marks.js";
import { TOKYO_NIGHT, gradientAt, toolColor } from "../palette.js";
import { programMark } from "../program-marks.js";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("../schemas.js").Element} Element */
/** @typedef {import("../schemas.js").ModContext} ModContext */

const PERCENT_SCALE = 100;
const METER_CELL_WIDTH_PX = 5;
const METER_CELL_HEIGHT_PX = 11;
const METER_CELL_GAP_PX = 2;
export const METER_CELL_STEP_PX = METER_CELL_WIDTH_PX + METER_CELL_GAP_PX;
const BOX_RADIUS_PX = 8;
const EDGE_ROW_HEIGHT_PX = 18;
const EDGE_MIDDLE_PX = EDGE_ROW_HEIGHT_PX / 2;
const EDGE_CORNER_WIDTH_PX = 10;
const EDGE_CAP_WIDTH_PX = 4;
const EDGE_MIN_LINE_WIDTH_PX = 8;
const CONTROL_HEIGHT_PX = 22;
const CONTROL_RADIUS_PX = 5;
const CONTROL_INSET_PX = 2;
const ICON_BUTTON_SIZE_PX = 24;
const ICON_SIZE_PX = 14;
const ROW_BUTTON_SIZE_PX = 18;
const ROW_BUTTON_ICON_SIZE_PX = 11;
const CHECKBOX_SIZE_PX = 14;
const CHECK_ICON_SIZE_PX = 11;
const DIALOG_BUTTON_HEIGHT_PX = 26;
const PROGRAM_MARK_SIZE_PX = 13;
const PRIMARY_HOVER_OPACITY = 0.85;
const PRIMARY_PRESSED_OPACITY = 0.7;
const KEYCAP_SIZE_PX = 16;
const TAB_DOT_SIZE_PX = 7;
export const ROW_LABEL_WIDTH_PX = 54;
const UI_ICON_FOLDER = "mods/herdwatch/icons/ui";
const UI_ICON_SIZE_PX = 12;
const AGENT_MARK_SIZE_PX = 14;
export const MARK_ONLY_COLUMN_PX = 20;
export const AGENT_MARKER = "●";
const SUPERSCRIPT_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

/**
 * @typedef {"gauge" | "bot" | "plug" | "folder-git-2" | "activity" | "server" | "cpu" | "memory-stick" | "hard-drive"
 *   | "arrow-down-up" | "microchip" | "git-branch" | "history" | "arrow-down-wide-narrow" | "triangle-alert" | "layers"
 *   | "archive" | "file-diff" | "arrow-down-to-line" | "keyboard" | "pin" | "pin-off" | "external-link" | "square"
 *   | "square-x" | "trash-2" | "git-merge" | "container" | "check"} UiGlyph
 */

/**
 * @template {string} Value
 * @typedef {object} ChoiceOption
 * @property {Value} value
 * @property {string} label
 * @property {string} tooltip
 * @property {number | null} [count]
 * @property {Color | null} [dotColor]
 * @property {UiGlyph} [glyph]
 */

/**
 * @template {string} Value
 * @typedef {object} ChoiceGroup
 * @property {string} id
 * @property {ChoiceOption<Value>[]} options
 * @property {Value} selected
 * @property {(value: Value, cx: ModContext) => void} onSelect gets the click's context, never one kept from a render
 * @property {boolean} [compact] in a narrow pane, a tab that is not open shows its glyph and count only
 */

/** @param {number} number */
export const superscript = (number) => String(number).split("").map((digit) => SUPERSCRIPT_DIGITS[Number(digit)]).join("");

/**
 * A Lucide glyph, drawn in the text color of its parent unless the caller sets one.
 * @param {UiGlyph} glyph
 * @param {number} sizePx
 */
export const uiIcon = (glyph, sizePx = UI_ICON_SIZE_PX) => svg(`${UI_ICON_FOLDER}/${glyph}.svg`).size(sizePx).flex_none();

/** @param {string} content @param {Color} color */
export const text = (content, color) => div().flex_none().text_color(color).child(content);

/** @param {string} content @param {Color} color */
export const truncatedText = (content, color) => div().min_w(0).truncate().text_color(color).child(content);

/** @param {string} content @param {number} widthPx @param {Color} color */
export const rightCell = (content, widthPx, color) => div().w(widthPx).flex_none().text_right().text_color(color).child(content);

/** @param {number} widthPx */
export const fixedCell = (widthPx) => div().w(widthPx).flex_none();

/** @param {string} label @param {UiGlyph} glyph */
export const rowLabel = (label, glyph) => h_flex().w(ROW_LABEL_WIDTH_PX).flex_none().gap(5).items_center().text_color(TOKYO_NIGHT.comment)
  .child(uiIcon(glyph)).child(label);

/** @param {...Element} parts */
export const titleRow = (...parts) => h_flex().gap(6).items_center().children(parts);

/** @param {string} label @param {number} number @param {Color} color */
export const hostTitle = (label, number, color) => titleRow(text(superscript(number), TOKYO_NIGHT.comment), uiIcon("server").text_color(color), text(label, color).font_semibold());

/** @param {UiGlyph} glyph @param {string} label @param {Color} color */
export const panelTitle = (glyph, label, color) => titleRow(uiIcon(glyph).text_color(color), text(label, color).font_semibold());

/**
 * Makes an element a button: pointer, tooltip, and a click that does not reach the pane under it.
 * The handler gets the click's context, for calls such as cx.open_url.
 * @template {Element} Target
 * @param {Target} element
 * @param {string} tooltip
 * @param {(cx: ModContext) => void} onPress
 * @returns {Target}
 */
export function pressable(element, tooltip, onPress) {
  return element.cursor_pointer().tooltip(tooltip).on_click((_event, cx) => {
    cx.stop_propagation();
    onPress(cx);
  });
}

/**
 * The hover and press look of a control that is not selected.
 * @template {Element} Target
 * @param {Target} element
 * @returns {Target}
 */
export const withIdleStates = (element) => element
  .hover((style) => style.bg(TOKYO_NIGHT.highlight).text_color(TOKYO_NIGHT.foreground))
  .active((style) => style.bg(TOKYO_NIGHT.border));

/**
 * A btop meter: a row of cells, filled up to the percent, each filled cell colored by its place on the gradient.
 * The row sets the height and the cells stretch to it, because a table draws many meters and each call costs.
 * @param {number | null} percent
 * @param {number} cellCount
 * @param {readonly Color[]} gradient
 */
export function meter(percent, cellCount, gradient) {
  const hasLoad = Number.isFinite(percent) && percent > 0;
  const filledCells = hasLoad ? Math.max(1, Math.round((Math.min(percent, PERCENT_SCALE) / PERCENT_SCALE) * cellCount)) : 0;
  const lastCellIndex = Math.max(1, cellCount - 1);
  const cells = Array.from({ length: cellCount }, (_unused, index) =>
    div().w(METER_CELL_WIDTH_PX).rounded(1).bg(index < filledCells ? gradientAt(gradient, index / lastCellIndex) : TOKYO_NIGHT.highlight));
  return h_flex().flex_none().h(METER_CELL_HEIGHT_PX).gap(METER_CELL_GAP_PX).items_stretch().children(cells);
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

/**
 * An agent's own mark, the way Herdr's sidebar draws it: a picture as it is, a one-color glyph in the text color.
 * An agent without a mark gets the Herdwatch sheep in the agent's own accent, so two unknown agents still look different.
 * @param {string} agentName
 * @param {number} sizePx
 */
export function agentIcon(agentName, sizePx = AGENT_MARK_SIZE_PX) {
  const mark = agentMark(agentName);
  if (!mark.tint) return image(mark.path).w(sizePx).h(sizePx).flex_none();
  const glyphColor = mark.isDefault ? toolColor(agentName) : TOKYO_NIGHT.foreground;
  return svg(mark.path).size(sizePx).flex_none().text_color(glyphColor);
}

/**
 * A program's mark when it has one (Next.js, Docker, PostgreSQL), then its name. A program without a mark never gets
 * the sheep, because the sheep means an agent. The tooltip gives the product name of the mark.
 * @param {string} id
 * @param {string} processName
 * @param {Color} color
 */
export function programLabel(id, processName, color) {
  const mark = programMark(processName);
  return h_flex().id(id).min_w(0).gap(5).items_center()
    .when(Boolean(mark), (element) => element.tooltip(mark.name)
      .child(svg(mark.path).size(PROGRAM_MARK_SIZE_PX).flex_none().text_color(TOKYO_NIGHT.foreground)))
    .child(truncatedText(processName, color));
}

/**
 * The agent's mark and its short name; in a narrow pane the mark alone. The tooltip gives the full product name.
 * @param {string} id
 * @param {string} agentName
 * @param {boolean} showName
 */
export function agentLabel(id, agentName, showName) {
  return h_flex().id(id).min_w(0).gap(6).items_center().tooltip(agentMark(agentName).name)
    .child(agentIcon(agentName))
    .when(showName, (element) => element.child(truncatedText(agentName, TOKYO_NIGHT.foreground)));
}

/**
 * A key hint drawn as a keycap. It turns blue while the keys work (the pane has the keyboard).
 * @param {string} label
 * @param {boolean} isLive
 */
export function keycap(label, isLive) {
  return div().flex_none().h(KEYCAP_SIZE_PX).min_w(KEYCAP_SIZE_PX).px(4).flex().items_center().justify_center().rounded(3).border_1()
    .border_color(isLive ? TOKYO_NIGHT.blue : TOKYO_NIGHT.border)
    .bg(isLive ? TOKYO_NIGHT.highlight : TOKYO_NIGHT.backgroundDark)
    .text_size(10.5).text_color(isLive ? TOKYO_NIGHT.blue : TOKYO_NIGHT.dim)
    .child(label);
}

/**
 * A segmented control. The chosen option is filled blue; the others are framed buttons with hover and press states.
 * @template {string} Value
 * @param {ChoiceGroup<Value>} group
 */
export function segmentedControl({ id, options, selected, onSelect }) {
  const segments = options.map((option) => {
    const segment = pressable(
      div().id(`${id}-${option.value}`).h(CONTROL_HEIGHT_PX - 2 * CONTROL_INSET_PX).px(9).flex().items_center()
        .rounded(CONTROL_RADIUS_PX - CONTROL_INSET_PX).text_size(11).font_semibold().child(option.label),
      option.tooltip,
      (cx) => onSelect(option.value, cx),
    );
    if (option.value === selected) return segment.bg(TOKYO_NIGHT.blue).text_color(TOKYO_NIGHT.background);
    return withIdleStates(segment.text_color(TOKYO_NIGHT.dim));
  });
  return h_flex().id(id).h(CONTROL_HEIGHT_PX).p(CONTROL_INSET_PX).gap(CONTROL_INSET_PX).items_center().rounded(CONTROL_RADIUS_PX)
    .border_1().border_color(TOKYO_NIGHT.border).bg(TOKYO_NIGHT.backgroundDark).children(segments);
}

/**
 * A square icon button with hover, press and tooltip.
 * @param {{ id: string, icon: string, tooltip: string, hoverColor?: Color, onPress: () => void }} button
 */
export function iconButton({ id, icon, tooltip, hoverColor = TOKYO_NIGHT.foreground, onPress }) {
  const frame = div().id(id).size(ICON_BUTTON_SIZE_PX).flex_none().flex().items_center().justify_center().rounded(CONTROL_RADIUS_PX)
    .border_1().border_color(TOKYO_NIGHT.border).text_color(TOKYO_NIGHT.dim)
    .hover((style) => style.bg(TOKYO_NIGHT.highlight).text_color(hoverColor).border_color(hoverColor))
    .active((style) => style.bg(TOKYO_NIGHT.border))
    .child(svg(icon).size(ICON_SIZE_PX));
  return pressable(frame, tooltip, onPress);
}

/**
 * A small glyph button for a table row. A disabled button keeps its tooltip, so it can say why.
 * @param {{ id: string, glyph: UiGlyph, tooltip: string, hoverColor?: Color, color?: Color, isDisabled?: boolean, onPress: (cx: ModContext) => void }} button
 */
export function rowButton({ id, glyph, tooltip, hoverColor = TOKYO_NIGHT.foreground, color = TOKYO_NIGHT.dim, isDisabled = false, onPress }) {
  const frame = div().id(id).size(ROW_BUTTON_SIZE_PX).flex_none().flex().items_center().justify_center().rounded(4)
    .child(uiIcon(glyph, ROW_BUTTON_ICON_SIZE_PX));
  if (isDisabled) return frame.text_color(TOKYO_NIGHT.terminalBlack).tooltip(tooltip);
  const live = frame.text_color(color)
    .hover((style) => style.bg(TOKYO_NIGHT.highlight).text_color(hoverColor))
    .active((style) => style.bg(TOKYO_NIGHT.border));
  return pressable(live, tooltip, onPress);
}

/**
 * @param {{ id: string, processName: string, pid: number, onPress: () => void }} button
 */
export const killButton = ({ id, processName, pid, onPress }) => rowButton({
  id,
  glyph: "square-x",
  hoverColor: TOKYO_NIGHT.red,
  tooltip: `Kill ${processName} (pid ${pid}) and the processes under it`,
  onPress,
});

/**
 * A framed text button for dialogs. The primary button is filled; a destructive one is red.
 * @param {{ id: string, label: string, tooltip: string, isPrimary?: boolean, isDestructive?: boolean, isDisabled?: boolean, onPress: (cx: ModContext) => void }} button
 */
export function textButton({ id, label, tooltip, isPrimary = false, isDestructive = false, isDisabled = false, onPress }) {
  const accent = isDestructive ? TOKYO_NIGHT.red : TOKYO_NIGHT.blue;
  const frame = h_flex().id(id).h(DIALOG_BUTTON_HEIGHT_PX).px(12).items_center().rounded(CONTROL_RADIUS_PX).border_1().font_semibold().child(label);
  if (isDisabled) return frame.border_color(TOKYO_NIGHT.border).text_color(TOKYO_NIGHT.comment).tooltip(tooltip);
  const look = isPrimary
    ? frame.bg(accent).border_color(accent).text_color(TOKYO_NIGHT.background).hover((style) => style.opacity(PRIMARY_HOVER_OPACITY))
    : withIdleStates(frame.border_color(TOKYO_NIGHT.border).text_color(TOKYO_NIGHT.foregroundDark));
  return pressable(look.active((style) => style.opacity(PRIMARY_PRESSED_OPACITY)), tooltip, onPress);
}

/**
 * A checkbox with its label; the whole row toggles it.
 * @param {{ id: string, label: string, isChecked: boolean, onToggle: (cx: ModContext) => void }} checkbox
 */
export function checkbox({ id, label, isChecked, onToggle }) {
  const box = div().size(CHECKBOX_SIZE_PX).flex_none().flex().items_center().justify_center().rounded(3).border_1()
    .border_color(isChecked ? TOKYO_NIGHT.blue : TOKYO_NIGHT.dim).bg(isChecked ? TOKYO_NIGHT.blue : TOKYO_NIGHT.backgroundDark)
    .text_color(TOKYO_NIGHT.background)
    .when(isChecked, (element) => element.child(uiIcon("check", CHECK_ICON_SIZE_PX)));
  const row = h_flex().id(id).gap(8).items_center().px(4).py(2).rounded(4).text_color(TOKYO_NIGHT.foreground).child(box).child(label);
  return pressable(withIdleStates(row), isChecked ? "Click to clear" : "Click to tick", onToggle);
}

/**
 * A row of tabs. The open tab is framed and filled; the others show hover and press states.
 * @template {string} Value
 * @param {ChoiceGroup<Value>} group
 */
export function tabStrip({ id, options, selected, onSelect, compact = false }) {
  const tabs = options.map((option) => {
    const isSelected = option.value === selected;
    const showLabel = isSelected || !compact || !option.glyph;
    const tab = pressable(
      h_flex().id(`${id}-${option.value}`).h(CONTROL_HEIGHT_PX).px(9).gap(6).flex_none().items_center().rounded(CONTROL_RADIUS_PX).border_1()
        .text_size(11.5)
        .when(Boolean(option.dotColor), (element) => element.child(div().size(TAB_DOT_SIZE_PX).rounded(4).flex_none().bg(option.dotColor)))
        .when(Boolean(option.glyph), (element) => element.child(uiIcon(option.glyph)))
        .when(showLabel, (element) => element.child(option.label))
        .when(Number.isFinite(option.count), (element) => element.child(div().text_size(10.5).text_color(TOKYO_NIGHT.comment).child(String(option.count)))),
      option.tooltip,
      (cx) => onSelect(option.value, cx),
    );
    if (isSelected) return tab.border_color(TOKYO_NIGHT.border).bg(TOKYO_NIGHT.highlight).text_color(TOKYO_NIGHT.foreground);
    return withIdleStates(tab.border_color(TOKYO_NIGHT.backgroundDark).text_color(TOKYO_NIGHT.dim));
  });
  return h_flex().id(id).gap(2).min_w(0).items_center().overflow_x_scrollbar().children(tabs);
}

/**
 * Filter chips: pill buttons with a count; the chosen one is filled blue.
 * @template {string} Value
 * @param {ChoiceGroup<Value>} group
 */
export function filterChips({ id, options, selected, onSelect }) {
  const chips = options.map((option) => {
    const chipButton = pressable(
      h_flex().id(`${id}-${option.value}`).h(20).px(8).gap(5).items_center().rounded(10).border_1().text_size(11)
        .when(Boolean(option.glyph), (element) => element.child(uiIcon(option.glyph, 11)))
        .child(option.label)
        .when(Number.isFinite(option.count), (element) => element.child(String(option.count))),
      option.tooltip,
      (cx) => onSelect(option.value, cx),
    );
    if (option.value === selected) return chipButton.bg(TOKYO_NIGHT.blue).border_color(TOKYO_NIGHT.blue).text_color(TOKYO_NIGHT.background);
    return withIdleStates(chipButton.bg(TOKYO_NIGHT.backgroundDark).border_color(TOKYO_NIGHT.border).text_color(TOKYO_NIGHT.dim));
  });
  return h_flex().id(id).gap(4).flex_wrap().children(chips);
}
