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
const COLUMN_WIDTH_PX = { app: 96, state: 96, cpu: 54, memory: 64, uptime: 46, kill: 18 };
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
  const cell = fixedCell(COLUMN_WIDTH_PX.kill);
  if (!Number.isFinite(pid)) return cell;
  return cell.child(killButton({ id: `agent-kill-${host.label}-${pid}`, processName: app, pid, onPress: () => view.onKill(host, pid) }));
}

/** @param {AgentView} agent @param {HostSnapshot} host @param {MonitorSettings} settings @param {ConsoleView} view */
function agentRow(agent, host, settings, view) {
  const { process } = agent;
  const { isWide } = view;
  const cpu = treeCpu(process);
  const folder = homeRelative(process.cwd, host.home);
  return h_flex().id(`agent-${host.label}-${process.pid}`).h(ROW_HEIGHT_PX).gap(8).items_center().tooltip(treeTooltip(process, folder))
    .child(fixedCell(isWide ? COLUMN_WIDTH_PX.app : MARK_ONLY_COLUMN_PX).child(agentLabel(`agent-app-${host.label}-${process.pid}`, process.app, isWide)))
    .child(stateCell(agent.state))
    .child(h_flex().flex_1().min_w(0).gap(6)
      .child(text(process.repository || "", TOKYO_NIGHT.blue))
      .child(truncatedText(process.branch || folder, TOKYO_NIGHT.foregroundDark)))
    .when(isWide, (element) => element.child(cpuSparkline(agent)))
    .child(rightCell(cpu.toFixed(1), COLUMN_WIDTH_PX.cpu, levelColor(percentLevel(Math.min(cpu, PERCENT_SCALE), settings))))
    .child(rightCell(storageSize(process.tree_rss_kb), COLUMN_WIDTH_PX.memory, TOKYO_NIGHT.foregroundDark))
    .child(rightCell(ageOrUnknown(process.elapsed_seconds), COLUMN_WIDTH_PX.uptime, TOKYO_NIGHT.comment))
    .child(killCell(agent, host, view));
}

/** @param {boolean} isWide */
function tableHeader(isWide) {
  return h_flex().gap(8).text_color(TOKYO_NIGHT.comment)
    .child(fixedCell(isWide ? COLUMN_WIDTH_PX.app : MARK_ONLY_COLUMN_PX).child(isWide ? "agent" : ""))
    .child(fixedCell(COLUMN_WIDTH_PX.state).child("state"))
    .child(div().flex_1().child("branch"))
    .when(isWide, (element) => element.child(fixedCell(CPU_SPARKLINE_SIZE.widthPx).child(CPU_SPARKLINE_TITLE)))
    .child(rightCell("cpu", COLUMN_WIDTH_PX.cpu, TOKYO_NIGHT.comment))
    .child(rightCell("mem", COLUMN_WIDTH_PX.memory, TOKYO_NIGHT.comment))
    .child(rightCell("up", COLUMN_WIDTH_PX.uptime, TOKYO_NIGHT.comment))
    .child(fixedCell(COLUMN_WIDTH_PX.kill));
}

/**
 * The coding agents on the host: app, state, branch, CPU history, the CPU and memory of each agent's process tree,
 * and run time.
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 */
export function agentsPanel(view, host, settings) {
  const workingCount = view.agents.filter((agent) => agent.state === "working").length;
  const busiestName = busiestAgentName(view.agents);
  const body = view.agents.length
    ? [v_flex().gap(2).child(tableHeader(view.isWide)).children(view.agents.map((agent) => agentRow(agent, host, settings, view)))]
    : [text("No coding agents are running on this host.", TOKYO_NIGHT.comment)];
  return panel({
    id: `agents-${host.label}`,
    title: panelTitle("bot", "agents", TOKYO_NIGHT.magenta),
    rightTitle: text(`${workingCount} working${busiestName ? ` · ${busiestName} uses most` : ""}`, TOKYO_NIGHT.comment),
    body,
  });
}
