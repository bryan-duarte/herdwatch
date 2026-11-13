import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { ageOrUnknown, homeRelative, minutesText, storageSize } from "../format.js";
import { percentLevel } from "../health.js";
import { AGENT_HISTORY_SAMPLES, SECONDS_PER_SAMPLE, samplesInRange } from "../history.js";
import { GRADIENTS, TOKYO_NIGHT, gradientAt, levelColor } from "../palette.js";
import { sparkline } from "./charts.js";
import { MARK_ONLY_COLUMN_PX, agentLabel, fixedCell, killButton, panel, panelTitle, rightCell, text, truncatedText } from "./widgets.js";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("../schemas.js").AgentProcess} AgentProcess */
/** @typedef {import("../schemas.js").AgentState} AgentState */
/** @typedef {import("../schemas.js").AgentView} AgentView */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */

const PERCENT_SCALE = 100;
const ROW_HEIGHT_PX = 24;
const STATE_DOT_SIZE_PX = 7;
const KILL_COLUMN_PX = 18;
/** In a narrow pane the app shows its mark only and the state its dot only, so the branch keeps room. */
const COLUMN_WIDTH_PX = {
  wide: { app: 96, state: 96, cpu: 54, memory: 64, uptime: 46 },
  narrow: { app: MARK_ONLY_COLUMN_PX, state: STATE_DOT_SIZE_PX, cpu: 40, memory: 52, uptime: 30 },
};
const COLUMN_GAP_PX = { wide: 8, narrow: 6 };
const CPU_SPARKLINE_SIZE = { widthPx: 110, heightPx: 18 };
const CPU_SPARKLINE_TITLE = `cpu ${minutesText(AGENT_HISTORY_SAMPLES * SECONDS_PER_SAMPLE)}`;
/** @type {Record<AgentState, { label: string, color: Color }>} */
const AGENT_STATE_LOOKS = {
  working: { label: "working", color: TOKYO_NIGHT.blue },
  blocked: { label: "needs you", color: TOKYO_NIGHT.yellow },
  idle: { label: "idle", color: TOKYO_NIGHT.comment },
  done: { label: "done", color: TOKYO_NIGHT.green },
};

/** @param {boolean} isWide */
const layoutOf = (isWide) => (isWide ? "wide" : "narrow");

/** @param {AgentState} state @param {boolean} isWide */
function stateCell(state, isWide) {
  const look = AGENT_STATE_LOOKS[state];
  const labelColor = state === "blocked" ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.foregroundDark;
  return h_flex().w(COLUMN_WIDTH_PX[layoutOf(isWide)].state).flex_none().gap(5).items_center()
    .child(div().size(STATE_DOT_SIZE_PX).rounded(4).bg(look.color))
    .when(isWide, (element) => element.child(text(look.label, labelColor)));
}

/**
 * The CPU of the agent and every process under it, so a test run or a build that the agent started counts too.
 * @param {AgentProcess} process
 */
const treeCpu = (process) => process.tree_cpu ?? process.cpu ?? 0;

/** @param {AgentProcess} process @param {string} folder */
function treeTooltip(process, folder) {
  if (!Number.isFinite(process.tree_count)) return folder;
  const processWord = process.tree_count === 1 ? "process" : "processes";
  return `${folder} · ${process.tree_count} ${processWord}: ${process.tree_names || process.app}`;
}

/** @param {AgentView[]} agents */
function busiestAgentName(agents) {
  const busiest = agents.reduce((best, agent) => (!best || treeCpu(agent.process) > treeCpu(best.process) ? agent : best), null);
  return busiest && treeCpu(busiest.process) > 0 ? busiest.process.app : null;
}

/** @param {AgentView} agent */
function cpuSparkline(agent) {
  const cpu = agent.process.cpu ?? 0;
  const peak = Math.max(PERCENT_SCALE, ...agent.cpuHistory.map((percent) => percent ?? 0));
  const color = gradientAt(GRADIENTS.cpu, Math.min(cpu, PERCENT_SCALE) / PERCENT_SCALE);
  return sparkline(samplesInRange(agent.cpuHistory, AGENT_HISTORY_SAMPLES), color, CPU_SPARKLINE_SIZE, peak);
}

/** @param {AgentView} agent @param {HostSnapshot} host @param {ConsoleView} view */
function killCell(agent, host, view) {
  const { pid, app } = agent.process;
  const cell = fixedCell(KILL_COLUMN_PX);
  if (!Number.isFinite(pid)) return cell;
  return cell.child(killButton({ id: `agent-kill-${host.label}-${pid}`, processName: app, pid, onPress: () => view.onKill(host, pid) }));
}

/**
 * @param {AgentView} agent @param {HostSnapshot} host @param {MonitorSettings} settings @param {ConsoleView} view
 * @param {boolean} hasSparkline
 */
function agentRow(agent, host, settings, view, hasSparkline) {
  const { process } = agent;
  const { isWide } = view;
  const layout = layoutOf(isWide);
  const widths = COLUMN_WIDTH_PX[layout];
  const cpu = treeCpu(process);
  const folder = homeRelative(process.cwd, host.home);
  return h_flex().id(`agent-${host.label}-${process.pid}`).h(ROW_HEIGHT_PX).gap(COLUMN_GAP_PX[layout]).items_center().tooltip(treeTooltip(process, folder))
    .child(fixedCell(widths.app).child(agentLabel(`agent-app-${host.label}-${process.pid}`, process.app, isWide)))
    .child(stateCell(agent.state, isWide))
    .child(h_flex().flex_1().min_w(0).gap(6)
      .child(truncatedText(process.repository || "", TOKYO_NIGHT.blue))
      .child(truncatedText(process.branch || folder, TOKYO_NIGHT.foregroundDark)))
    .when(hasSparkline, (element) => element.child(cpuSparkline(agent)))
    .child(rightCell(cpu.toFixed(1), widths.cpu, levelColor(percentLevel(Math.min(cpu, PERCENT_SCALE), settings))))
    .child(rightCell(storageSize(process.tree_rss_kb), widths.memory, TOKYO_NIGHT.foregroundDark))
    .child(rightCell(ageOrUnknown(process.elapsed_seconds), widths.uptime, TOKYO_NIGHT.comment))
    .child(killCell(agent, host, view));
}

/** @param {boolean} isWide @param {boolean} hasSparkline */
function tableHeader(isWide, hasSparkline) {
  const layout = layoutOf(isWide);
  const widths = COLUMN_WIDTH_PX[layout];
  return h_flex().gap(COLUMN_GAP_PX[layout]).text_color(TOKYO_NIGHT.comment)
    .child(fixedCell(widths.app).child(isWide ? "agent" : ""))
    .child(fixedCell(widths.state).child(isWide ? "state" : ""))
    .child(div().flex_1().min_w(0).child("branch"))
    .when(hasSparkline, (element) => element.child(fixedCell(CPU_SPARKLINE_SIZE.widthPx).child(CPU_SPARKLINE_TITLE)))
    .child(rightCell("cpu", widths.cpu, TOKYO_NIGHT.comment))
    .child(rightCell("mem", widths.memory, TOKYO_NIGHT.comment))
    .child(rightCell("up", widths.uptime, TOKYO_NIGHT.comment))
    .child(fixedCell(KILL_COLUMN_PX));
}

/**
 * The coding agents on the host: app, state, branch, CPU history, the CPU and memory of each agent's process tree,
 * and run time. The overview passes showSparklines false: there, the sparklines cost more than the rest of the box.
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 * @param {{ showSparklines?: boolean }} [options]
 */
export function agentsPanel(view, host, settings, { showSparklines = true } = {}) {
  const hasSparkline = view.isWide && showSparklines;
  const workingCount = view.agents.filter((agent) => agent.state === "working").length;
  const busiestName = busiestAgentName(view.agents);
  const body = view.agents.length
    ? [v_flex().gap(2).child(tableHeader(view.isWide, hasSparkline)).children(view.agents.map((agent) => agentRow(agent, host, settings, view, hasSparkline)))]
    : [text("No coding agents are running on this host.", TOKYO_NIGHT.comment)];
  return panel({
    id: `agents-${host.label}`,
    title: panelTitle("bot", "agents", TOKYO_NIGHT.magenta),
    rightTitle: text(`${workingCount} working${busiestName ? ` · ${busiestName} uses most` : ""}`, TOKYO_NIGHT.comment),
    body,
  });
}
