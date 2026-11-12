import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { ageOrUnknown, homeRelative, minutesText } from "../format.js";
import { percentLevel } from "../health.js";
import { AGENT_HISTORY_SAMPLES, SECONDS_PER_SAMPLE, samplesInRange } from "../history.js";
import { GRADIENTS, TOKYO_NIGHT, gradientAt, levelColor } from "../palette.js";
import { sparkline } from "./charts.js";
import { MARK_ONLY_COLUMN_PX, agentLabel, fixedCell, panel, panelTitle, rightCell, text, truncatedText } from "./widgets.js";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("../schemas.js").AgentState} AgentState */
/** @typedef {import("../schemas.js").AgentView} AgentView */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */

const PERCENT_SCALE = 100;
const ROW_HEIGHT_PX = 24;
const STATE_DOT_SIZE_PX = 7;
const COLUMN_WIDTH_PX = { app: 96, state: 96, cpu: 54, uptime: 46 };
const CPU_SPARKLINE_SIZE = { widthPx: 110, heightPx: 18 };
const CPU_SPARKLINE_TITLE = `cpu ${minutesText(AGENT_HISTORY_SAMPLES * SECONDS_PER_SAMPLE)}`;
/** @type {Record<AgentState, { label: string, color: Color }>} */
const AGENT_STATE_LOOKS = {
  working: { label: "working", color: TOKYO_NIGHT.blue },
  blocked: { label: "needs you", color: TOKYO_NIGHT.yellow },
  idle: { label: "idle", color: TOKYO_NIGHT.comment },
  done: { label: "done", color: TOKYO_NIGHT.green },
};

/** @param {AgentState} state */
function stateCell(state) {
  const look = AGENT_STATE_LOOKS[state];
  const labelColor = state === "blocked" ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.foregroundDark;
  return h_flex().w(COLUMN_WIDTH_PX.state).flex_none().gap(5).items_center()
    .child(div().size(STATE_DOT_SIZE_PX).rounded(4).bg(look.color))
    .child(text(look.label, labelColor));
}

/** @param {AgentView} agent */
function cpuSparkline(agent) {
  const cpu = agent.process.cpu ?? 0;
  const peak = Math.max(PERCENT_SCALE, ...agent.cpuHistory.map((percent) => percent ?? 0));
  const color = gradientAt(GRADIENTS.cpu, Math.min(cpu, PERCENT_SCALE) / PERCENT_SCALE);
  return sparkline(samplesInRange(agent.cpuHistory, AGENT_HISTORY_SAMPLES), color, CPU_SPARKLINE_SIZE, peak);
}

/** @param {AgentView} agent @param {HostSnapshot} host @param {MonitorSettings} settings @param {boolean} isWide */
function agentRow(agent, host, settings, isWide) {
  const { process } = agent;
  const cpu = process.cpu ?? 0;
  const folder = homeRelative(process.cwd, host.home);
  return h_flex().id(`agent-${host.label}-${process.pid}`).h(ROW_HEIGHT_PX).gap(8).items_center().tooltip(folder)
    .child(fixedCell(isWide ? COLUMN_WIDTH_PX.app : MARK_ONLY_COLUMN_PX).child(agentLabel(`agent-app-${host.label}-${process.pid}`, process.app, isWide)))
    .child(stateCell(agent.state))
    .child(h_flex().flex_1().min_w(0).gap(6)
      .child(text(process.repository || "", TOKYO_NIGHT.blue))
      .child(truncatedText(process.branch || folder, TOKYO_NIGHT.foregroundDark)))
    .when(isWide, (element) => element.child(cpuSparkline(agent)))
    .child(rightCell(cpu.toFixed(1), COLUMN_WIDTH_PX.cpu, levelColor(percentLevel(Math.min(cpu, PERCENT_SCALE), settings))))
    .child(rightCell(ageOrUnknown(process.elapsed_seconds), COLUMN_WIDTH_PX.uptime, TOKYO_NIGHT.comment));
}

/** @param {boolean} isWide */
function tableHeader(isWide) {
  return h_flex().gap(8).text_color(TOKYO_NIGHT.comment)
    .child(fixedCell(isWide ? COLUMN_WIDTH_PX.app : MARK_ONLY_COLUMN_PX).child(isWide ? "agent" : ""))
    .child(fixedCell(COLUMN_WIDTH_PX.state).child("state"))
    .child(div().flex_1().child("branch"))
    .when(isWide, (element) => element.child(fixedCell(CPU_SPARKLINE_SIZE.widthPx).child(CPU_SPARKLINE_TITLE)))
    .child(rightCell("cpu", COLUMN_WIDTH_PX.cpu, TOKYO_NIGHT.comment))
    .child(rightCell("up", COLUMN_WIDTH_PX.uptime, TOKYO_NIGHT.comment));
}

/**
 * The coding agents on the host: app, state, branch, CPU history and run time.
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 */
export function agentsPanel(view, host, settings) {
  const workingCount = view.agents.filter((agent) => agent.state === "working").length;
  const body = view.agents.length
    ? [v_flex().gap(2).child(tableHeader(view.isWide)).children(view.agents.map((agent) => agentRow(agent, host, settings, view.isWide)))]
    : [text("No coding agents are running on this host.", TOKYO_NIGHT.comment)];
  return panel({
    id: `agents-${host.label}`,
    title: panelTitle("bot", "agents", TOKYO_NIGHT.magenta),
    rightTitle: text(`${workingCount} working`, TOKYO_NIGHT.comment),
    body,
  });
}
