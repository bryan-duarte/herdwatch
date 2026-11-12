import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { homeRelative } from "../format.js";
import { TOKYO_NIGHT } from "../palette.js";
import { MARK_ONLY_COLUMN_PX, agentLabel, fixedCell, panel, panelTitle, rightCell, text, truncatedText } from "./widgets.js";

/** @typedef {import("../schemas.js").AgentView} AgentView */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").ListeningPort} ListeningPort */

const ROW_HEIGHT_PX = 22;
const COLUMN_WIDTH_PX = { port: 64, wideProcess: 150, narrowProcess: 110, agent: 96 };

/** @param {AgentView[]} agents @param {number | null} pid */
const agentProcessWithPid = (agents, pid) => agents.find(({ process }) => process.pid === pid)?.process ?? null;

/**
 * Ports that belong to an agent come first, then by port number.
 * @param {ListeningPort} first
 * @param {ListeningPort} second
 */
const agentPortsFirst = (first, second) => Number(Boolean(second.agent_pid)) - Number(Boolean(first.agent_pid)) || first.port - second.port;

/** @param {boolean} isWide */
const processColumnPx = (isWide) => (isWide ? COLUMN_WIDTH_PX.wideProcess : COLUMN_WIDTH_PX.narrowProcess);

/** @param {boolean} isWide */
const agentColumnPx = (isWide) => (isWide ? COLUMN_WIDTH_PX.agent : MARK_ONLY_COLUMN_PX);

/** @param {ListeningPort} port @param {AgentView[]} agents @param {HostSnapshot} host @param {boolean} isWide */
function portRow(port, agents, host, isWide) {
  const owner = agentProcessWithPid(agents, port.agent_pid);
  return h_flex().h(ROW_HEIGHT_PX).gap(8).items_center()
    .child(rightCell(`:${port.port}`, COLUMN_WIDTH_PX.port, TOKYO_NIGHT.cyan))
    .child(fixedCell(processColumnPx(isWide)).truncate().text_color(port.process ? TOKYO_NIGHT.foregroundDark : TOKYO_NIGHT.comment).child(port.process || "other user"))
    .child(fixedCell(agentColumnPx(isWide)).child(owner ? agentLabel(`port-agent-${port.port}`, owner.app, isWide) : text(isWide ? "system" : "", TOKYO_NIGHT.comment)))
    .child(truncatedText(owner ? homeRelative(owner.cwd, host.home) : "", TOKYO_NIGHT.comment).flex_1());
}

/** @param {boolean} isWide */
function tableHeader(isWide) {
  return h_flex().gap(8).text_color(TOKYO_NIGHT.comment)
    .child(rightCell("port", COLUMN_WIDTH_PX.port, TOKYO_NIGHT.comment))
    .child(fixedCell(processColumnPx(isWide)).child("process"))
    .child(fixedCell(agentColumnPx(isWide)).child(isWide ? "agent" : ""))
    .child(div().flex_1().child("worktree"));
}

/**
 * Listening TCP ports, each with the agent that owns the process (found through its parent processes).
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 */
export function portsPanel(view, host) {
  const ports = [...host.ports].sort(agentPortsFirst);
  const body = ports.length
    ? [v_flex().gap(2).child(tableHeader(view.isWide)).children(ports.map((port) => portRow(port, view.agents, host, view.isWide)))]
    : [text("No listening TCP ports, or the host does not show them to this user.", TOKYO_NIGHT.comment)];
  return panel({ id: `ports-${host.label}`, title: panelTitle("plug", "ports", TOKYO_NIGHT.cyan), rightTitle: text("listening", TOKYO_NIGHT.comment), body });
}
