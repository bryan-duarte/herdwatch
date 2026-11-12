import { Background, PathBuilder, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { GRADIENTS, TOKYO_NIGHT, gradientAt } from "../palette.js";

/** @typedef {import("gpui-kit").Color} Color */

const PERCENT_SCALE = 100;
const GRID_LINE_PERCENTS = [25, 50, 75];
const AREA_OPACITY = 0.32;
const SPARKLINE_AREA_OPACITY = 0.16;
const LINE_WIDTH_PX = 1.5;
const SECOND_LINE_WIDTH_PX = 1.3;
const SECOND_LINE_DASH = [3, 2];
const END_DOT_SIZE_PX = 5;
const MARKER_SIZE_PX = 6;
const MARKER_LINE_OPACITY = 0.55;
const CORE_CELL_HEIGHT_PX = 14;
const CORE_MIN_OPACITY = 0.35;
const VERTICAL_GRADIENT_ANGLE = 0;

/**
 * @typedef {object} ChartMarkerLook
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
 * @property {ChartMarkerLook[]} [markers]
 * @property {boolean} [grid]
 */

/** @typedef {{ index: number, sample: number }} ChartPoint */
/** @typedef {{ x: `${number}%`, y: `${number}%` }} ChartCoordinate */

/** @param {number} index @param {number} count */
const xPercent = (index, count) => (count > 1 ? (index / (count - 1)) * PERCENT_SCALE : 0);

/** @param {number | null} sample @param {number} maximum */
const yPercent = (sample, maximum) => PERCENT_SCALE - (Math.min(Math.max(sample ?? 0, 0), maximum) / maximum) * PERCENT_SCALE;

/** @param {number} percent */
const percentCoordinate = (percent) => /** @type {`${number}%`} */ (`${percent.toFixed(2)}%`);

/** @type {Map<number, `${number}%`[]>} */
const xCoordinatesOfCount = new Map();

/**
 * The x of each slot of a chart with count slots: the same on every render with that range.
 * @param {number} count
 */
function xCoordinates(count) {
  const known = xCoordinatesOfCount.get(count);
  if (known) return known;
  const coordinates = Array.from({ length: count }, (_unused, index) => percentCoordinate(xPercent(index, count)));
  xCoordinatesOfCount.set(count, coordinates);
  return coordinates;
}

/**
 * Splits samples into runs without nulls, so a host that was down leaves a gap in the line.
 * @param {(number | null)[]} samples
 * @returns {ChartPoint[][]}
 */
function unbrokenRuns(samples) {
  /** @type {ChartPoint[][]} */
  const runs = [];
  /** @type {ChartPoint[]} */
  let currentRun = [];
  samples.forEach((sample, index) => {
    if (Number.isFinite(sample)) {
      currentRun.push({ index, sample });
      return;
    }
    if (currentRun.length) runs.push(currentRun);
    currentRun = [];
  });
  if (currentRun.length) runs.push(currentRun);
  return runs;
}

/**
 * The runs of at least two points, as coordinates: computed once and shared by the area and its line.
 * @param {(number | null)[]} samples @param {number} maximum
 * @returns {ChartCoordinate[][]}
 */
function drawableRuns(samples, maximum) {
  const xOfSlot = xCoordinates(samples.length);
  return unbrokenRuns(samples).filter((run) => run.length > 1)
    .map((run) => run.map((point) => ({ x: xOfSlot[point.index], y: percentCoordinate(yPercent(point.sample, maximum)) })));
}

/** @param {ChartCoordinate[][]} runs */
function areaPath(runs) {
  const builder = PathBuilder.fill();
  for (const run of runs) {
    builder.move_to(run[0].x, "100%");
    run.forEach((point) => builder.line_to(point.x, point.y));
    builder.line_to(run[run.length - 1].x, "100%").close();
  }
  return builder.build();
}

/** @param {ChartCoordinate[][]} runs @param {number} widthPx @param {readonly number[] | null} dash */
function linePath(runs, widthPx, dash = null) {
  const builder = PathBuilder.stroke(widthPx);
  if (dash) builder.dash_array(dash);
  for (const run of runs) {
    run.forEach((point, position) => {
      if (position === 0) builder.move_to(point.x, point.y);
      else builder.line_to(point.x, point.y);
    });
  }
  return builder.build();
}

/** @param {readonly Color[]} gradient @param {number} opacity */
const verticalGradient = (gradient, opacity) =>
  Background.linear_gradient(VERTICAL_GRADIENT_ANGLE, Background.stop(gradient[0], 0), Background.stop(gradient[gradient.length - 1], PERCENT_SCALE)).opacity(opacity);

/** @param {ChartMarkerLook} marker */
function markerElement(marker) {
  const left = percentCoordinate(marker.position * PERCENT_SCALE);
  return div().absolute().top(0).bottom(0).left(left).w(1).bg(marker.color).opacity(MARKER_LINE_OPACITY)
    .child(div().absolute().top(0).left(-MARKER_SIZE_PX / 2).size(MARKER_SIZE_PX).rounded(1).bg(marker.color))
    .tooltip(marker.text);
}

/** @param {(number | null)[]} samples @param {number} maximum @param {readonly Color[]} gradient */
function endDot(samples, maximum, gradient) {
  const lastIndex = samples.length - 1;
  const lastSample = samples[lastIndex];
  return div().absolute().size(END_DOT_SIZE_PX).rounded(END_DOT_SIZE_PX)
    .left(percentCoordinate(xPercent(lastIndex, samples.length))).top(percentCoordinate(yPercent(lastSample, maximum)))
    .ml(-END_DOT_SIZE_PX).mt(-END_DOT_SIZE_PX / 2).bg(gradientAt(gradient, Math.min(lastSample, maximum) / maximum));
}

/** @param {number} percent */
const gridLine = (percent) => div().absolute().left(0).right(0).top(`${percent}%`).h(1).bg(TOKYO_NIGHT.highlight);

/**
 * A btop history chart: gradient area, a gradient line, an optional dashed second line, event markers and an end dot.
 * @param {AreaChartOptions} options
 */
export function areaChart({ samples, heightPx, gradient, maximum = PERCENT_SCALE, secondLine = null, secondLineColor = TOKYO_NIGHT.purple, markers = [], grid = true }) {
  const chart = div().relative().w_full().h(heightPx).rounded(3).bg(TOKYO_NIGHT.backgroundDark).overflow_hidden();
  if (grid) GRID_LINE_PERCENTS.forEach((percent) => chart.child(gridLine(percent)));
  const runs = drawableRuns(samples, maximum);
  if (runs.length) {
    chart.child(window.paint_path(areaPath(runs), verticalGradient(gradient, AREA_OPACITY)).absolute().size_full());
    chart.child(window.paint_path(linePath(runs, LINE_WIDTH_PX), verticalGradient(gradient, 1)).absolute().size_full());
  }
  const secondRuns = secondLine ? drawableRuns(secondLine, maximum) : [];
  if (secondRuns.length) {
    chart.child(window.paint_path(linePath(secondRuns, SECOND_LINE_WIDTH_PX, SECOND_LINE_DASH), secondLineColor).absolute().size_full());
  }
  markers.forEach((marker) => chart.child(markerElement(marker)));
  if (Number.isFinite(samples[samples.length - 1])) chart.child(endDot(samples, maximum, gradient));
  return chart;
}

/**
 * A small filled line for a table cell.
 * @param {(number | null)[]} samples
 * @param {Color} color
 * @param {{ widthPx: number, heightPx: number }} size
 * @param {number} maximum
 */
export function sparkline(samples, color, { widthPx, heightPx }, maximum = PERCENT_SCALE) {
  const chart = div().relative().w(widthPx).h(heightPx).flex_none();
  const runs = drawableRuns(samples, maximum);
  if (!runs.length) return chart;
  return chart
    .child(window.paint_path(areaPath(runs), Background.solid(color).opacity(SPARKLINE_AREA_OPACITY)).absolute().size_full())
    .child(window.paint_path(linePath(runs, SECOND_LINE_WIDTH_PX), color).absolute().size_full());
}

/**
 * One cell per CPU core, colored and dimmed by its load.
 * @param {(number | null)[]} cores
 * @param {number} cellWidthPx
 */
export function coreStrip(cores, cellWidthPx) {
  return h_flex().gap(2).flex_wrap().children(cores.map((corePercent, index) => {
    const load = Number.isFinite(corePercent) ? Math.min(corePercent, PERCENT_SCALE) : 0;
    const loadShare = load / PERCENT_SCALE;
    return div().w(cellWidthPx).h(CORE_CELL_HEIGHT_PX).rounded(2).tooltip(`core ${index}: ${Math.round(load)}%`)
      .bg(gradientAt(GRADIENTS.cpu, loadShare))
      .opacity(CORE_MIN_OPACITY + (1 - CORE_MIN_OPACITY) * loadShare);
  }));
}
