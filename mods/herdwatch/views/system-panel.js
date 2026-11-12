import { h_flex, v_flex } from "gpui-base";
import { ageOrUnknown, ageSince, byteRate, kibAsGib, mibAsGib, percentText, storageSize } from "../format.js";
import { isStale, percentLevel } from "../health.js";
import { eventMarkers, samplesInRange } from "../history.js";
import { GRADIENTS, TOKYO_NIGHT, levelColor } from "../palette.js";
import { worktreeTotals, worktreesOfHost } from "../worktrees.js";
import { areaChart, coreStrip, sparkline } from "./charts.js";
import { hostTitle, meter, panel, rightCell, rowLabel, text, titleRow, truncatedText, uiIcon } from "./widgets.js";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").Element} Element */
/** @typedef {import("../schemas.js").HostEvent} HostEvent */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */

const CHART_HEIGHT_PX = 58;
const RESOURCE_METER_CELLS = 20;
const PERCENT_WIDTH_PX = 44;
const MANY_CORES = 16;
const WIDE_CORE_CELL_PX = 10;
const NARROW_CORE_CELL_PX = 6;
const NET_SPARKLINE_SAMPLES = 40;
const NET_SPARKLINE_SIZE = { widthPx: 70, heightPx: 16 };
/** @type {Record<HostEvent["kind"], Color>} */
const EVENT_COLORS = { start: TOKYO_NIGHT.blue, done: TOKYO_NIGHT.green, alert: TOKYO_NIGHT.red };

/** @param {import("./widgets.js").UiGlyph} glyph @param {string} label @param {string} reading @param {Color} readingColor @param {Element} chart */
const chartBlock = (glyph, label, reading, readingColor, chart) => v_flex().flex_1().min_w(0).gap(4)
  .child(h_flex().justify_between()
    .child(titleRow(uiIcon(glyph).text_color(TOKYO_NIGHT.comment), text(label, TOKYO_NIGHT.comment)))
    .child(text(reading, readingColor).font_semibold()))
  .child(chart);

/** @param {string} label @param {import("./widgets.js").UiGlyph} glyph @param {...Element} cells */
const resourceRow = (label, glyph, ...cells) => h_flex().gap(10).items_center().child(rowLabel(label, glyph)).children(cells);

/** @param {number | null} percent @param {MonitorSettings} settings */
const percentCell = (percent, settings) => rightCell(percentText(percent), PERCENT_WIDTH_PX, levelColor(percentLevel(percent, settings)));

/** @param {ConsoleView} view @param {HostSnapshot} host @param {MonitorSettings} settings */
function hostCharts(view, host, settings) {
  const series = view.history.hosts[host.label];
  const markers = eventMarkers(view.history, host.label, view.rangeSamples)
    .map((marker) => ({ position: marker.position, color: EVENT_COLORS[marker.kind], text: marker.text }));
  const cpuChart = areaChart({ samples: samplesInRange(series?.cpu, view.rangeSamples), heightPx: CHART_HEIGHT_PX, gradient: GRADIENTS.cpu, markers });
  const memoryChart = areaChart({
    samples: samplesInRange(series?.mem, view.rangeSamples),
    heightPx: CHART_HEIGHT_PX,
    gradient: GRADIENTS.memory,
    secondLine: samplesInRange(series?.swap, view.rangeSamples),
    secondLineColor: TOKYO_NIGHT.purple,
  });
  const cpuLabel = `cpu · ${host.ncpu ?? "?"} cores`;
  const memoryLabel = `mem ${kibAsGib(host.mem_used_kb)} / ${kibAsGib(host.mem_total_kb)} GiB`;
  return h_flex().gap(10)
    .child(chartBlock("cpu", cpuLabel, percentText(host.cpu_pct), levelColor(percentLevel(host.cpu_pct, settings)), cpuChart))
    .child(chartBlock("memory-stick", memoryLabel, percentText(host.mem_pct), levelColor(percentLevel(host.mem_pct, settings)), memoryChart));
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

/** @param {ConsoleView} view @param {HostSnapshot} host @param {MonitorSettings} settings */
function resourceRows(view, host, settings) {
  const rows = v_flex().gap(5);
  const coreCellPx = host.cores.length > MANY_CORES || !view.isWide ? NARROW_CORE_CELL_PX : WIDE_CORE_CELL_PX;
  if (host.cores.length) rows.child(resourceRow("cores", "cpu", coreStrip(host.cores, coreCellPx)));
  rows.child(resourceRow("disk", "hard-drive",
    meter(host.disk_pct, RESOURCE_METER_CELLS, GRADIENTS.disk),
    percentCell(host.disk_pct, settings),
    truncatedText(diskDetail(host), TOKYO_NIGHT.dim)));
  rows.child(networkRow(view, host));
  if (host.gpu) {
    const videoMemory = `${mibAsGib(host.gpu.mem_used_mib)} / ${mibAsGib(host.gpu.mem_total_mib)} GiB`;
    rows.child(resourceRow("gpu", "microchip",
      meter(host.gpu.pct, RESOURCE_METER_CELLS, GRADIENTS.swap),
      percentCell(host.gpu.pct, settings),
      truncatedText(`${host.gpu.name} · vram ${videoMemory}`, TOKYO_NIGHT.dim)));
  }
  rows.child(resourceRow("wt", "git-branch", truncatedText(worktreeSummary(view, host), TOKYO_NIGHT.teal)));
  return rows;
}

/**
 * The overview box of one host: CPU and memory charts, then cores, disk, network, GPU and worktree rows.
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
    body: [hostCharts(view, host, settings), resourceRows(view, host, settings)],
  });
}
