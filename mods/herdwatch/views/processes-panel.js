import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { percentLevel } from "../health.js";
import { GRADIENTS, TOKYO_NIGHT, gradientAt, levelColor } from "../palette.js";
import { AGENT_MARKER, METER_CELL_STEP_PX, fixedCell, meter, panel, pressable, rightCell, segmentedControl, text, titleRow, truncatedText, withIdleStates } from "./widgets.js";

/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("../schemas.js").ProcessRow} ProcessRow */
/** @typedef {import("../schemas.js").ProcessSort} ProcessSort */

const PERCENT_SCALE = 100;
const MEMORY_PERCENT_AT_TOP_COLOR = 25;
const ROW_HEIGHT_PX = 20;
const CPU_METER_CELLS = 5;
const TABLE_MAX_WIDTH_PX = 820;
const COLUMN_WIDTH_PX = { marker: 14, pid: 64, cpuMeter: CPU_METER_CELLS * METER_CELL_STEP_PX, percent: 62 };
const SORT_MARKER = "▾";
/** @type {Record<ProcessSort, { column: string, name: string, key: string, button: string }>} */
const SORTS = {
  cpu: { column: "cpu%", name: "CPU", key: "c", button: "CPU" },
  mem: { column: "mem%", name: "memory", key: "m", button: "MEM" },
};
const SORT_OPTIONS = /** @type {ProcessSort[]} */ (["cpu", "mem"]).map((sort) => ({
  value: sort,
  label: SORTS[sort].button,
  tooltip: `Sort processes by ${SORTS[sort].name} (${SORTS[sort].key})`,
}));

/** @param {ProcessRow} process @param {ProcessSort} sort */
const sortValue = (process, sort) => (sort === "mem" ? process.mem : process.cpu) ?? 0;

/** @param {ProcessSort} sort @param {ConsoleView} view */
function sortableHeader(sort, view) {
  const isActive = view.sort === sort;
  const { column, name, key } = SORTS[sort];
  const header = h_flex().id(`column-${sort}`).w(COLUMN_WIDTH_PX.percent).flex_none().justify_end().px(4).rounded(3)
    .text_color(isActive ? TOKYO_NIGHT.blue : TOKYO_NIGHT.comment)
    .child(isActive ? `${column} ${SORT_MARKER}` : column);
  return pressable(withIdleStates(header), `Sort by ${name} (${key})`, () => view.onSort(sort));
}

/** @param {ConsoleView} view */
function tableHeader(view) {
  return h_flex().gap(8).text_color(TOKYO_NIGHT.comment)
    .child(fixedCell(COLUMN_WIDTH_PX.marker))
    .child(rightCell("pid", COLUMN_WIDTH_PX.pid, TOKYO_NIGHT.comment))
    .child(div().flex_1().child("program"))
    .when(view.isWide, (element) => element.child(fixedCell(COLUMN_WIDTH_PX.cpuMeter)))
    .child(sortableHeader("cpu", view))
    .child(sortableHeader("mem", view));
}

/** @param {ProcessRow} process @param {MonitorSettings} settings @param {boolean} isWide */
function processRow(process, settings, isWide) {
  const cpu = process.cpu ?? 0;
  const memory = process.mem ?? 0;
  const cpuShare = Math.min(cpu, PERCENT_SCALE) / PERCENT_SCALE;
  const memoryShare = Math.min(memory, MEMORY_PERCENT_AT_TOP_COLOR) / MEMORY_PERCENT_AT_TOP_COLOR;
  const cpuColor = levelColor(percentLevel(Math.floor(cpu), settings), gradientAt(GRADIENTS.cpu, cpuShare));
  return h_flex().h(ROW_HEIGHT_PX).gap(8).items_center()
    .child(fixedCell(COLUMN_WIDTH_PX.marker).text_color(TOKYO_NIGHT.green).child(process.agent ? AGENT_MARKER : ""))
    .child(rightCell(String(process.pid ?? "?"), COLUMN_WIDTH_PX.pid, TOKYO_NIGHT.comment))
    .child(truncatedText(process.name, process.agent ? TOKYO_NIGHT.foreground : TOKYO_NIGHT.foregroundDark).flex_1())
    .when(isWide, (element) => element.child(meter(Math.min(cpu, PERCENT_SCALE), CPU_METER_CELLS, GRADIENTS.cpu)))
    .child(rightCell(cpu.toFixed(1), COLUMN_WIDTH_PX.percent, cpuColor))
    .child(rightCell(memory.toFixed(1), COLUMN_WIDTH_PX.percent, gradientAt(GRADIENTS.memory, memoryShare)));
}

/**
 * The busiest processes of the host, sorted by CPU or memory; agent processes carry a dot.
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 */
export function processesPanel(view, host, settings) {
  const topProcesses = [...host.processes].sort((first, second) => sortValue(second, view.sort) - sortValue(first, view.sort)).slice(0, settings.top_n);
  return [
    h_flex().justify_end().gap(8).items_center().child(text("sort", TOKYO_NIGHT.comment))
      .child(segmentedControl({ id: "sort", options: SORT_OPTIONS, selected: view.sort, onSelect: view.onSort })),
    panel({
      id: `procs-${host.label}`,
      title: titleRow(text("procs", TOKYO_NIGHT.magenta).font_semibold(), text(`top ${topProcesses.length}`, TOKYO_NIGHT.comment)),
      rightTitle: text(`by ${view.sort === "mem" ? "memory" : "cpu"}`, TOKYO_NIGHT.comment),
      body: [v_flex().max_w(TABLE_MAX_WIDTH_PX).gap(2).child(tableHeader(view)).children(topProcesses.map((process) => processRow(process, settings, view.isWide)))],
    }),
  ];
}
