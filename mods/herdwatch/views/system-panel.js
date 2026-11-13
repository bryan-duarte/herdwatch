import { h_flex, v_flex } from "gpui-base";
import { ageOrUnknown, ageSince, byteRate, kibAsGib, mibAsGib, minutesText, percentText, storageSize } from "../format.js";
import { isStale, percentLevel } from "../health.js";
import { SECONDS_PER_SAMPLE, eventMarkers, samplesInRange } from "../history.js";
import { GRADIENTS, TOKYO_NIGHT, levelColor } from "../palette.js";
import { worktreeTotals, worktreesOfHost } from "../worktrees.js";
import { columnChart, sparkline } from "./charts.js";
import { ROW_LABEL_WIDTH_PX, hostTitle, meter, panel, panelTitle, rowLabel, text, truncatedText } from "./widgets.js";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").Element} Element */
/** @typedef {import("../schemas.js").HostEvent} HostEvent */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */

const CHART_HEIGHT_PX = 40;
const AXIS_TEXT_SIZE_PX = 10;
const RESOURCE_METER_CELLS = 20;
const ROW_GAP_PX = 10;
const NET_SPARKLINE_SAMPLES = 40;
const NET_SPARKLINE_SIZE = { widthPx: 70, heightPx: 16 };
/** @type {Record<HostEvent["kind"], Color>} */
const EVENT_COLORS = { start: TOKYO_NIGHT.blue, done: TOKYO_NIGHT.green, alert: TOKYO_NIGHT.red };

/** @param {string} label @param {import("./widgets.js").UiGlyph} glyph @param {...Element} cells */
const resourceRow = (label, glyph, ...cells) => h_flex().gap(ROW_GAP_PX).items_center().child(rowLabel(label, glyph)).children(cells);

/**
 * A metered reading: the label and its meter, then the percent (bold) and the detail on a line under the
 * meter. Under it rather than beside it, the numbers keep their room in a narrow pane.
 * @param {{ label: string, glyph: import("./widgets.js").UiGlyph, percent: number | null, gradient: readonly Color[], detail: string, settings: MonitorSettings }} reading
 */
const meterReading = ({ label, glyph, percent, gradient, detail, settings }) => v_flex().gap(2)
  .child(resourceRow(label, glyph, meter(percent, RESOURCE_METER_CELLS, gradient)))
  .child(h_flex().pl(ROW_LABEL_WIDTH_PX + ROW_GAP_PX).gap(8).items_center()
    .child(percentCell(percent, settings))
    .child(truncatedText(detail, TOKYO_NIGHT.dim)));

/** @param {number | null} percent @param {MonitorSettings} settings */
const percentCell = (percent, settings) => text(percentText(percent), levelColor(percentLevel(percent, settings))).font_semibold();

/** The time scale under a history chart: the range on the left, now on the right. @param {string} rangeText */
const timeAxis = (rangeText) => h_flex().justify_between().text_size(AXIS_TEXT_SIZE_PX).text_color(TOKYO_NIGHT.comment)
  .child(`${rangeText} ago`).child("now");

/**
 * @typedef {object} MetricBoxOptions
 * @property {string} id
 * @property {string} label
 * @property {import("./widgets.js").UiGlyph} glyph
 * @property {number | null} percent
 * @property {readonly Color[]} gradient
 * @property {string} detail
 * @property {(number | null)[]} samples
 * @property {import("./charts.js").ChartMarkerLook[]} [markers]
 * @property {string} rangeText
 * @property {MonitorSettings} settings
 */

/**
 * CPU or memory in a box of its own, with the name in the top edge: the meter, the percent and the detail under it,
 * then the history in columns over its time axis. Inside the box, the chart can only belong to that reading.
 * @param {MetricBoxOptions} metric
 */
const metricBox = ({ id, label, glyph, percent, gradient, detail, samples, markers = [], rangeText, settings }) => panel({
  id,
  title: panelTitle(glyph, label, gradient[0]),
  body: [
    v_flex().gap(2)
      .child(meter(percent, RESOURCE_METER_CELLS, gradient))
      .child(h_flex().gap(8).items_center().child(percentCell(percent, settings)).child(truncatedText(detail, TOKYO_NIGHT.dim))),
    v_flex().gap(2).child(columnChart({ samples, heightPx: CHART_HEIGHT_PX, gradient, markers })).child(timeAxis(rangeText)),
  ],
});

/** @param {ConsoleView} view @param {HostSnapshot} host @param {MonitorSettings} settings */
function hostCharts(view, host, settings) {
  const series = view.history.hosts[host.label];
  const rangeText = minutesText(view.rangeSamples * SECONDS_PER_SAMPLE);
  const markers = eventMarkers(view.history, host.label, view.rangeSamples)
    .map((marker) => ({ position: marker.position, color: EVENT_COLORS[marker.kind], text: marker.text }));
  const swap = Number.isFinite(host.swap_pct) && Number(host.swap_pct) > 0 ? ` · swap ${percentText(host.swap_pct)}` : "";
  return v_flex().gap(10)
    .child(metricBox({
      id: `cpu-box-${host.label}`, label: "cpu", glyph: "cpu", percent: host.cpu_pct, gradient: GRADIENTS.cpu, detail: "",
      samples: samplesInRange(series?.cpu, view.rangeSamples), markers, rangeText, settings,
    }))
    .child(metricBox({
      id: `mem-box-${host.label}`, label: "mem", glyph: "memory-stick", percent: host.mem_pct, gradient: GRADIENTS.memory,
      detail: `${kibAsGib(host.mem_used_kb)} / ${kibAsGib(host.mem_total_kb)} GiB${swap}`,
      samples: samplesInRange(series?.mem, view.rangeSamples), rangeText, settings,
    }));
}

/** @param {HostSnapshot} host */
function diskDetail(host) {
  const hasDiskSize = Number.isFinite(host.disk_total_kb) && Number.isFinite(host.disk_used_kb);
  const free = hasDiskSize ? storageSize(host.disk_total_kb - host.disk_used_kb) : "?";
  const hasReadWriteRates = Number.isFinite(host.disk_read_rate) || Number.isFinite(host.disk_write_rate);
  if (hasReadWriteRates) return `${free} free · r ${byteRate(host.disk_read_rate)} w ${byteRate(host.disk_write_rate)}`;
  if (Number.isFinite(host.disk_io_rate)) return `${free} free · io ${byteRate(host.disk_io_rate)}`;
  return `${free} free`;
}

/** @param {ConsoleView} view @param {HostSnapshot} host */
function worktreeSummary(view, host) {
  const worktrees = worktreesOfHost(view.worktrees, host);
  if (worktrees.state === "pending") return "measuring worktrees…";
  const { staleCount } = worktreeTotals(worktrees.items, view.agents);
  return `${storageSize(worktrees.total_kb)} in ${worktrees.items.length} worktrees · ${staleCount} stale`;
}

/** @param {ConsoleView} view @param {HostSnapshot} host */
function networkRow(view, host) {
  const series = view.history.hosts[host.label];
  const received = (series?.rx ?? []).slice(-NET_SPARKLINE_SAMPLES);
  const sent = (series?.tx ?? []).slice(-NET_SPARKLINE_SAMPLES);
  const sharedMaximum = Math.max(1, ...received.map((rate) => rate ?? 0), ...sent.map((rate) => rate ?? 0));
  return resourceRow("net", "arrow-down-up",
    sparkline(received, TOKYO_NIGHT.teal, NET_SPARKLINE_SIZE, sharedMaximum),
    sparkline(sent, TOKYO_NIGHT.cyan, NET_SPARKLINE_SIZE, sharedMaximum),
    truncatedText(`↓ ${byteRate(host.net_rx_rate)} ↑ ${byteRate(host.net_tx_rate)}`, TOKYO_NIGHT.dim));
}

/** @param {HostSnapshot} host */
const coreCount = (host) => host.ncpu ?? host.cores.length;

/** @param {HostSnapshot} host */
const coresRow = (host) => resourceRow("cores", "cpu", text(String(coreCount(host)), TOKYO_NIGHT.foreground).font_semibold());

/** @param {ConsoleView} view @param {HostSnapshot} host @param {MonitorSettings} settings */
function resourceRows(view, host, settings) {
  const rows = v_flex().gap(5);
  rows.child(meterReading({
    label: "disk", glyph: "hard-drive", percent: host.disk_pct, gradient: GRADIENTS.storage,
    detail: diskDetail(host), settings,
  }));
  rows.child(networkRow(view, host));
  if (host.gpu) {
    const videoMemory = `${mibAsGib(host.gpu.mem_used_mib)} / ${mibAsGib(host.gpu.mem_total_mib)} GiB`;
    rows.child(meterReading({
      label: "gpu", glyph: "microchip", percent: host.gpu.pct, gradient: GRADIENTS.swap,
      detail: `${host.gpu.name} · vram ${videoMemory}`, settings,
    }));
  }
  rows.child(resourceRow("wt", "git-branch", truncatedText(worktreeSummary(view, host), TOKYO_NIGHT.teal)));
  return rows;
}

/**
 * The overview box of one host: the core count, CPU and memory (each in its own box with its history chart),
 * then disk, network, GPU and worktree rows.
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 * @param {number} hostNumber
 * @param {MonitorSettings} settings
 */
export function systemPanel(view, host, hostNumber, settings) {
  const stale = isStale(host, settings);
  const uptime = `${host.os} · up ${ageOrUnknown(host.uptime_seconds)}`;
  const rightTitle = stale ? `${uptime} · stale ${ageSince(host.updated_at)}` : uptime;
  return panel({
    id: `system-${host.label}`,
    title: hostTitle(host.label, hostNumber, TOKYO_NIGHT.blue),
    rightTitle: text(rightTitle, stale ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.comment),
    body: [...(coreCount(host) ? [coresRow(host)] : []), hostCharts(view, host, settings), resourceRows(view, host, settings)],
  });
}
