import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { homeRelative } from "../format.js";
import { TOKYO_NIGHT } from "../palette.js";
import { OPENING_TUNNEL_NOTE, portNoteKey, tunnelOfPort } from "../tunnels.js";
import { MARK_ONLY_COLUMN_PX, agentLabel, fixedCell, killButton, panel, panelTitle, programLabel, rightCell, rowButton, text, truncatedText } from "./widgets.js";

/** @typedef {import("../schemas.js").AgentProcess} AgentProcess */
/** @typedef {import("../schemas.js").AgentView} AgentView */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").Element} Element */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").ListeningPort} ListeningPort */
/** @typedef {import("../schemas.js").Tunnel} Tunnel */

/**
 * @typedef {object} PortRowContext
 * @property {ConsoleView} view
 * @property {HostSnapshot} host
 * @property {Tunnel | null} tunnel  the running tunnel of this port
 * @property {string} note           a tunnel that opens, or why the last port action failed
 */

const ROW_HEIGHT_PX = 22;
const COLUMN_WIDTH_PX = { pin: 18, port: 56, wideProcess: 150, narrowProcess: 110, agent: 96, open: 132, kill: 18 };
const FIRST_KILLABLE_PID = 2;

/** @param {AgentView[]} agents @param {number | null} pid */
const agentProcessWithPid = (agents, pid) => agents.find(({ process }) => process.pid === pid)?.process ?? null;

/**
 * Pinned ports first, then ports of agents, then by number.
 * @param {ListeningPort} first
 * @param {ListeningPort} second
 */
const portOrder = (first, second) => Number(second.pinned) - Number(first.pinned)
  || Number(Boolean(second.agent_pid)) - Number(Boolean(first.agent_pid))
  || first.port - second.port;

/** @param {boolean} isWide */
const processColumnPx = (isWide) => (isWide ? COLUMN_WIDTH_PX.wideProcess : COLUMN_WIDTH_PX.narrowProcess);

/** @param {boolean} isWide */
const agentColumnPx = (isWide) => (isWide ? COLUMN_WIDTH_PX.agent : MARK_ONLY_COLUMN_PX);

/** @param {ListeningPort} port */
const isDown = (port) => port.pinned && !port.listening;

/** @param {ListeningPort} port @param {PortRowContext} context */
function pinButton(port, { view, host }) {
  return rowButton({
    id: `port-pin-${host.label}-${port.port}`,
    glyph: "pin",
    color: port.pinned ? TOKYO_NIGHT.blue : TOKYO_NIGHT.terminalBlack,
    hoverColor: TOKYO_NIGHT.blue,
    tooltip: port.pinned ? `Unpin :${port.port}` : `Pin :${port.port}: it stays at the top and alerts when it stops`,
    onPress: (cx) => view.ports.onTogglePin(host.label, port, cx),
  });
}

/** @param {ListeningPort} port @param {PortRowContext} context */
function processCell(port, { view, host }) {
  const cell = fixedCell(processColumnPx(view.isWide));
  if (isDown(port)) return cell.child(text("down", TOKYO_NIGHT.red));
  if (!port.process) return cell.child(text("other user", TOKYO_NIGHT.comment));
  return cell.child(programLabel(`port-process-${host.label}-${port.port}`, port.process, TOKYO_NIGHT.foregroundDark));
}

/** @param {AgentProcess | null} owner @param {ListeningPort} port @param {PortRowContext} context */
function agentCell(owner, port, { view }) {
  const cell = fixedCell(agentColumnPx(view.isWide));
  if (owner) return cell.child(agentLabel(`port-agent-${port.port}`, owner.app, view.isWide));
  return cell.child(text(view.isWide && port.listening ? "system" : "", TOKYO_NIGHT.comment));
}

/** @param {string} note */
const isFailureNote = (note) => Boolean(note) && note !== OPENING_TUNNEL_NOTE;

/** @param {Element} cell @param {ListeningPort} port @param {Tunnel} tunnel @param {PortRowContext} context */
function forwardedTunnelControls(cell, port, tunnel, { view, host }) {
  return cell
    .child(rowButton({ id: `port-open-${host.label}-${port.port}`, glyph: "external-link", color: TOKYO_NIGHT.green, tooltip: `Open localhost:${tunnel.localPort} in the browser`, onPress: (cx) => view.ports.onOpenPort(host, port, cx) }))
    .child(text(`forwarded :${tunnel.localPort}`, TOKYO_NIGHT.green))
    .child(rowButton({ id: `port-stop-${host.label}-${port.port}`, glyph: "square", hoverColor: TOKYO_NIGHT.red, tooltip: "Stop the tunnel", onPress: (cx) => view.ports.onStopTunnel(tunnel, cx) }));
}

/** @param {ListeningPort} port @param {PortRowContext} context */
function openCell(port, context) {
  const { view, host, tunnel, note } = context;
  const cell = h_flex().w(COLUMN_WIDTH_PX.open).flex_none().gap(4).items_center().justify_end();
  if (!port.listening) return cell;
  if (tunnel) return forwardedTunnelControls(cell, port, tunnel, context);
  const isOpening = note === OPENING_TUNNEL_NOTE;
  const hasFailed = isFailureNote(note);
  return cell
    .when(isOpening, (element) => element.child(text("opening…", TOKYO_NIGHT.comment)))
    .child(rowButton({
      id: `port-open-${host.label}-${port.port}`,
      glyph: "external-link",
      color: hasFailed ? TOKYO_NIGHT.red : TOKYO_NIGHT.dim,
      hoverColor: TOKYO_NIGHT.cyan,
      tooltip: hasFailed ? note : `Open :${port.port} in the browser through an SSH tunnel`,
      isDisabled: isOpening,
      onPress: (cx) => view.ports.onOpenPort(host, port, cx),
    }));
}

/** @param {ListeningPort} port @param {PortRowContext} context */
function killCell(port, { view, host }) {
  const cell = fixedCell(COLUMN_WIDTH_PX.kill);
  const canKill = port.listening && Number.isFinite(port.pid) && port.pid >= FIRST_KILLABLE_PID;
  if (!canKill) return cell;
  return cell.child(killButton({
    id: `port-kill-${host.label}-${port.port}`,
    processName: port.process || "the process",
    pid: port.pid,
    onPress: () => view.onKill(host, port.pid),
  }));
}

/** @param {ListeningPort} port @param {PortRowContext} context */
function portRow(port, context) {
  const { view, host, note } = context;
  const owner = agentProcessWithPid(view.agents, port.agent_pid);
  return h_flex().id(`port-${host.label}-${port.port}`).h(ROW_HEIGHT_PX).gap(8).items_center()
    .when(isFailureNote(note), (element) => element.tooltip(note))
    .child(pinButton(port, context))
    .child(rightCell(`:${port.port}`, COLUMN_WIDTH_PX.port, isDown(port) ? TOKYO_NIGHT.red : TOKYO_NIGHT.cyan))
    .child(processCell(port, context))
    .child(agentCell(owner, port, context))
    .child(truncatedText(owner ? homeRelative(owner.cwd, host.home) : "", TOKYO_NIGHT.comment).flex_1())
    .child(openCell(port, context))
    .child(killCell(port, context));
}

/** @param {boolean} isWide */
function tableHeader(isWide) {
  return h_flex().gap(8).text_color(TOKYO_NIGHT.comment)
    .child(fixedCell(COLUMN_WIDTH_PX.pin))
    .child(rightCell("port", COLUMN_WIDTH_PX.port, TOKYO_NIGHT.comment))
    .child(fixedCell(processColumnPx(isWide)).child("process"))
    .child(fixedCell(agentColumnPx(isWide)).child(isWide ? "agent" : ""))
    .child(div().flex_1().child("worktree"))
    .child(fixedCell(COLUMN_WIDTH_PX.open))
    .child(fixedCell(COLUMN_WIDTH_PX.kill));
}

/** @param {ConsoleView} view @param {HostSnapshot} host @param {ListeningPort} port @returns {PortRowContext} */
const portRowContext = (view, host, port) => ({
  view,
  host,
  tunnel: tunnelOfPort(view.tunnels, host.label, port.port),
  note: view.portNotes[portNoteKey(host.label, port.port)] ?? "",
});

/**
 * Listening TCP ports, each with the agent that owns the process (found through its parent processes).
 * Pinned ports stay at the top, also when they stop listening.
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 */
export function portsPanel(view, host) {
  const ports = [...host.ports].sort(portOrder);
  const downCount = ports.filter(isDown).length;
  const body = ports.length
    ? [v_flex().gap(2).child(tableHeader(view.isWide)).children(ports.map((port) => portRow(port, portRowContext(view, host, port))))]
    : [text("No listening TCP ports, or the host does not show them to this user.", TOKYO_NIGHT.comment)];
  const rightTitle = downCount ? text(`${downCount} pinned down`, TOKYO_NIGHT.red) : text("listening", TOKYO_NIGHT.comment);
  return panel({ id: `ports-${host.label}`, title: panelTitle("plug", "ports", TOKYO_NIGHT.cyan), rightTitle, body });
}
