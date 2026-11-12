import { Background, PathBuilder, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { TOKYO_NIGHT, gradientAt } from "./palette.js";

/** @typedef {import("gpui-kit").Color} Color */

const PERCENT_SCALE = 100;
const GRID_FRACTIONS = [25, 50, 75];
const AREA_OPACITY = 0.32;
const LINE_WIDTH_PX = 1.5;
const SECOND_LINE_WIDTH_PX = 1.3;
const SECOND_LINE_DASH = [3, 2];
const END_DOT_SIZE_PX = 5;
const MARKER_SIZE_PX = 6;
const CORE_CELL_HEIGHT_PX = 14;
const CORE_MIN_OPACITY = 0.35;
const VERTICAL_GRADIENT_ANGLE = 0;

/**
 * @typedef {object} ChartMarker
 * @property {number} position   0..1 across the chart
 * @property {Color} color
 * @property {string} text
 */

/**
 * @typedef {object} AreaChartOptions
 * @property {(number | null)[]} samples
 * @property {number} heightPx
 * @property {readonly Color[]} gradient
 * @property {number} [maximum]
 * @property {(number | null)[] | null} [secondLine]
 * @property {Color} [secondLineColor]
 * @property {ChartMarker[]} [markers]
 * @property {boolean} [grid]
 */

/** @param {number} index @param {number} count */
const xPercent = (index, count) => (count > 1 ? (index / (count - 1)) * PERCENT_SCALE : 0);

/** @param {number | null} value @param {number} maximum */
const yPercent = (value, maximum) => PERCENT_SCALE - (Math.min(Math.max(value ?? 0, 0), maximum) / maximum) * PERCENT_SCALE;

/** @param {number} value */
const percentCoordinate = (value) => /** @type {`${number}%`} */ (`${value.toFixed(2)}%`);

/**
 * Splits samples into runs without nulls, so a host that was down leaves a gap.
 * @param {(number | null)[]} samples
 * @returns {{ index: number, value: number }[][]}
 */
function runs(samples) {
  /** @type {{ index: number, value: number }[][]} */
  const result = [];
  /** @type {{ index: number, value: number }[]} */
  let current = [];
  samples.forEach((value, index) => {
    if (Number.isFinite(value)) {
      current.push({ index, value });
      return;
    }
    if (current.length) result.push(current);
    current = [];
  });
  if (current.length) result.push(current);
  return result;
}

/** @param {(number | null)[]} samples @param {number} maximum */
function areaPath(samples, maximum) {
  const builder = PathBuilder.fill();
  const count = samples.length;
  runs(samples).filter((run) => run.length > 1).forEach((run) => {
    builder.move_to(percentCoordinate(xPercent(run[0].index, count)), "100%");
    run.forEach((point) => builder.line_to(percentCoordinate(xPercent(point.index, count)), percentCoordinate(yPercent(point.value, maximum))));
    builder.line_to(percentCoordinate(xPercent(run[run.length - 1].index, count)), "100%").close();
  });
  return builder.build();
}

/** @param {(number | null)[]} samples @param {number} maximum @param {number} widthPx @param {readonly number[] | null} dash */
function linePath(samples, maximum, widthPx, dash = null) {
  const builder = PathBuilder.stroke(widthPx);
  if (dash) builder.dash_array(dash);
  const count = samples.length;
  runs(samples).filter((run) => run.length > 1).forEach((run) => {
    run.forEach((point, position) => {
      const x = percentCoordinate(xPercent(point.index, count));
      const y = percentCoordinate(yPercent(point.value, maximum));
      if (position === 0) builder.move_to(x, y);
      else builder.line_to(x, y);
    });
  });
  return builder.build();
}

/** @param {readonly Color[]} gradient @param {number} opacity */
const verticalGradient = (gradient, opacity) =>
  Background.linear_gradient(VERTICAL_GRADIENT_ANGLE, Background.stop(gradient[0], 0), Background.stop(gradient[gradient.length - 1], PERCENT_SCALE)).opacity(opacity);

/** @param {(number | null)[]} samples */
const hasLine = (samples) => runs(samples).some((run) => run.length > 1);

/** @param {ChartMarker} marker */
function markerElement(marker) {
  const left = percentCoordinate(marker.position * PERCENT_SCALE);
  return div().absolute().top(0).bottom(0).left(left).w(1).bg(marker.color).opacity(0.55)
    .child(div().absolute().top(0).left(-MARKER_SIZE_PX / 2).size(MARKER_SIZE_PX).rounded(1).bg(marker.color));
}

/**
 * A btop history chart: gradient area, a gradient line, an optional dashed second line, event markers and an end dot.
 * @param {AreaChartOptions} options
 */
export function areaChart({ samples, heightPx, gradient, maximum = PERCENT_SCALE, secondLine = null, secondLineColor = TOKYO_NIGHT.purple, markers = [], grid = true }) {
  const chart = div().relative().w_full().h(heightPx).rounded(3).bg(TOKYO_NIGHT.backgroundDark).overflow_hidden();
  if (grid) GRID_FRACTIONS.forEach((fraction) => chart.child(div().absolute().left(0).right(0).top(`${fraction}%`).h(1).bg(TOKYO_NIGHT.highlight)));
  if (hasLine(samples)) {
    chart.child(window.paint_path(areaPath(samples, maximum), verticalGradient(gradient, AREA_OPACITY)).absolute().size_full());
    chart.child(window.paint_path(linePath(samples, maximum, LINE_WIDTH_PX), verticalGradient(gradient, 1)).absolute().size_full());
  }
  if (secondLine && hasLine(secondLine)) {
    chart.child(window.paint_path(linePath(secondLine, maximum, SECOND_LINE_WIDTH_PX, SECOND_LINE_DASH), secondLineColor).absolute().size_full());
  }
  markers.forEach((marker) => chart.child(markerElement(marker).tooltip(marker.text)));
  const lastIndex = samples.length - 1;
  const lastValue = samples[lastIndex];
  if (Number.isFinite(lastValue)) {
    chart.child(div().absolute().size(END_DOT_SIZE_PX).rounded(END_DOT_SIZE_PX)
      .left(percentCoordinate(xPercent(lastIndex, samples.length))).top(percentCoordinate(yPercent(lastValue, maximum)))
      .ml(-END_DOT_SIZE_PX).mt(-END_DOT_SIZE_PX / 2).bg(gradientAt(gradient, Math.min(lastValue, maximum) / maximum)));
  }
  return chart;
}

/**
 * A small filled line for a table cell.
 * @param {(number | null)[]} samples
 * @param {Color} color
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {number} maximum
 */
export function sparkline(samples, color, widthPx, heightPx, maximum = PERCENT_SCALE) {
  const chart = div().relative().w(widthPx).h(heightPx).flex_none();
  if (!hasLine(samples)) return chart;
  return chart
    .child(window.paint_path(areaPath(samples, maximum), Background.solid(color).opacity(0.16)).absolute().size_full())
    .child(window.paint_path(linePath(samples, maximum, SECOND_LINE_WIDTH_PX), color).absolute().size_full());
}

/**
 * One cell per CPU core, colored and dimmed by its load.
 * @param {(number | null)[]} cores
 * @param {number} cellWidthPx
 */
export function coreStrip(cores, cellWidthPx) {
  return h_flex().gap(2).flex_wrap().children(cores.map((value, index) => {
    const load = Number.isFinite(value) ? Math.min(value, PERCENT_SCALE) : 0;
    return div().w(cellWidthPx).h(CORE_CELL_HEIGHT_PX).rounded(2).tooltip(`core ${index}: ${Math.round(load)}%`)
      .bg(gradientAt([TOKYO_NIGHT.green, TOKYO_NIGHT.yellow, TOKYO_NIGHT.red], load / PERCENT_SCALE))
      .opacity(CORE_MIN_OPACITY + (1 - CORE_MIN_OPACITY) * (load / PERCENT_SCALE));
  }));
}
