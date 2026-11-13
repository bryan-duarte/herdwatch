import { Background, PathBuilder, div } from "gpui-kit";
import { TOKYO_NIGHT, gradientAt } from "../palette.js";

/** @typedef {import("gpui-kit").Color} Color */

const PERCENT_SCALE = 100;
const GRID_LINE_PERCENTS = [25, 50, 75];
const SPARKLINE_AREA_OPACITY = 0.16;
const SPARKLINE_LINE_WIDTH_PX = 1.3;
const COLUMN_SHARE_OF_SLOT = 0.7;
const MIN_COLUMN_PERCENT = 3;
const COLOR_BANDS = 10;
const SCALE_TEXT_SIZE_PX = 9;
const MARKER_SIZE_PX = 6;
const MARKER_LINE_OPACITY = 0.55;

/**
 * @typedef {object} ChartMarkerLook
 * @property {number} position   0..1 across the chart
 * @property {Color} color
 * @property {string} text
 */

/**
 * @typedef {object} ColumnChartOptions
 * @property {(number | null)[]} samples
 * @property {number} heightPx
 * @property {readonly Color[]} gradient
 * @property {ChartMarkerLook[]} [markers]
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

/** @param {ChartCoordinate[][]} runs @param {number} widthPx */
function linePath(runs, widthPx) {
  const builder = PathBuilder.stroke(widthPx);
  for (const run of runs) {
    run.forEach((point, position) => {
      if (position === 0) builder.move_to(point.x, point.y);
      else builder.line_to(point.x, point.y);
    });
  }
  return builder.build();
}

/** @type {Map<number, { left: `${number}%`, right: `${number}%` }[]>} */
const columnEdgesOfCount = new Map();

/**
 * The left and right x of each column of a chart with count slots: the same on every render with that range.
 * @param {number} count
 */
function columnEdges(count) {
  const known = columnEdgesOfCount.get(count);
  if (known) return known;
  const slotPercent = PERCENT_SCALE / count;
  const edges = Array.from({ length: count }, (_unused, index) => ({
    left: percentCoordinate(index * slotPercent),
    right: percentCoordinate((index + COLUMN_SHARE_OF_SLOT) * slotPercent),
  }));
  columnEdgesOfCount.set(count, edges);
  return edges;
}

/**
 * One column for each sample, colored by its value on the gradient. The columns of one color band are one polygon
 * that runs along the bottom edge from column to column, so a chart costs one call for each band, not one for each
 * sample. A missing sample leaves its slot empty.
 * @param {(number | null)[]} samples
 * @param {readonly Color[]} gradient
 */
function columnPaths(samples, gradient) {
  const edges = columnEdges(samples.length);
  /** @type {Map<number, [`${number}%`, `${number}%` | "100%"][]>} */
  const outlineOfBand = new Map();
  samples.forEach((sample, index) => {
    if (!Number.isFinite(sample)) return;
    const level = Math.min(Math.max(sample, 0), PERCENT_SCALE) / PERCENT_SCALE;
    const band = Math.min(COLOR_BANDS - 1, Math.floor(level * COLOR_BANDS));
    if (!outlineOfBand.has(band)) outlineOfBand.set(band, []);
    const { left, right } = edges[index];
    const top = percentCoordinate(Math.min(yPercent(sample, PERCENT_SCALE), PERCENT_SCALE - MIN_COLUMN_PERCENT));
    outlineOfBand.get(band).push([left, "100%"], [left, top], [right, top], [right, "100%"]);
  });
  return [...outlineOfBand].map(([band, outline]) => ({
    path: PathBuilder.fill().add_polygon(outline, true).build(),
    color: gradientAt(gradient, (band + 0.5) / COLOR_BANDS),
  }));
}

/** @param {ChartMarkerLook} marker */
function markerElement(marker) {
  const left = percentCoordinate(marker.position * PERCENT_SCALE);
  return div().absolute().top(0).bottom(0).left(left).w(1).bg(marker.color).opacity(MARKER_LINE_OPACITY)
    .child(div().absolute().top(0).left(-MARKER_SIZE_PX / 2).size(MARKER_SIZE_PX).rounded(1).bg(marker.color))
    .tooltip(marker.text);
}

/** @param {number} percent */
const gridLine = (percent) => div().absolute().left(0).right(0).top(`${percent}%`).h(1).bg(TOKYO_NIGHT.highlight);

/** The 100% mark on the top edge, so a short column reads as a low value and not as a small chart. */
const scaleText = () => div().absolute().top(0).right(3).text_size(SCALE_TEXT_SIZE_PX).text_color(TOKYO_NIGHT.comment).child("100%");

/**
 * A btop history chart in columns, from 0 to 100%: one column for each sample, colored by its value, with the grid,
 * the 100% mark and event markers. The newest sample is the column at the right edge.
 * @param {ColumnChartOptions} options
 */
export function columnChart({ samples, heightPx, gradient, markers = [] }) {
  const chart = div().relative().w_full().h(heightPx).rounded(3).bg(TOKYO_NIGHT.backgroundDark).overflow_hidden();
  GRID_LINE_PERCENTS.forEach((percent) => chart.child(gridLine(percent)));
  columnPaths(samples, gradient).forEach(({ path, color }) => chart.child(window.paint_path(path, color).absolute().size_full()));
  chart.child(scaleText());
  markers.forEach((marker) => chart.child(markerElement(marker)));
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
    .child(window.paint_path(linePath(runs, SPARKLINE_LINE_WIDTH_PX), color).absolute().size_full());
}
