import { agents, panes, spaces } from "herdr";
import { agentKey } from "./history.js";

/** @typedef {import("./types.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./types.js").MonitorHistory} MonitorHistory */
/** @typedef {import("./types.js").AgentView} AgentView */
/** @typedef {import("./types.js").AgentState} AgentState */

const WORKING_CPU_PERCENT = 3;
const KNOWN_STATES = new Set(["working", "blocked", "idle", "done"]);
/** Program table keys that name no particular agent. */
const GENERIC_PROGRAM_KEYS = new Set(["agent", "program", "shell"]);

/**
 * @typedef {object} HerdrAgent
 * @property {string | null} machine
 * @property {string} app
 * @property {string} cwd
 * @property {AgentState} state
 */

/** @param {string | null | undefined} name */
const normalizedApp = (name) => (name ?? "").toLowerCase().replace(/-cli$/, "").replace(/-code$/, "").replace(/-agent$/, "");

/**
 * The key of Herdr.app's program table ("cursor" for cursor-agent, "kimi" for kimi-code), which the probe also prints.
 * An agent without its own table entry falls back to the app name it reports.
 * @param {{ app: string | null, program?: { key?: string, name?: string } }} agent
 */
function herdrAppKey(agent) {
  const key = agent.program?.key;
  return key && !GENERIC_PROGRAM_KEYS.has(key) ? key : normalizedApp(agent.app ?? agent.program?.name);
}

/** @returns {HerdrAgent[]} */
export function herdrAgents() {
  const spaceMachines = new Map(spaces().map((space) => [space.id, space.machine ?? null]));
  const paneFolders = new Map(panes().map((pane) => [pane.pane, pane.cwd ?? ""]));
  return agents()
    .filter((agent) => KNOWN_STATES.has(agent.status))
    .map((agent) => ({
      machine: spaceMachines.get(agent.space) ?? null,
      app: herdrAppKey(agent),
      cwd: paneFolders.get(agent.pane) ?? "",
      state: /** @type {AgentState} */ (agent.status),
    }));
}

/** @param {HostSnapshot} host @param {string | null} machine */
function isSameMachine(host, machine) {
  if (!machine) return false;
  const targetHost = host.target.replace(/^ssh:\/\//, "").replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  return machine === host.label || machine === host.target || machine === targetHost;
}

/**
 * Joins the agent processes found on a host with the agents Herdr.app reports (same machine, same app, same folder).
 * A match takes Herdr's state; any other process gets "working" or "idle" from its CPU use.
 * @param {HostSnapshot} host
 * @param {MonitorHistory} history
 * @param {HerdrAgent[]} reported
 * @returns {AgentView[]}
 */
export function agentViews(host, history, reported) {
  return host.agents.map((process) => {
    const match = reported.find((agent) => isSameMachine(host, agent.machine) && agent.cwd === process.cwd
      && (agent.app.startsWith(normalizedApp(process.app)) || normalizedApp(process.app).startsWith(agent.app)));
    const cpuState = /** @type {AgentState} */ ((process.cpu ?? 0) >= WORKING_CPU_PERCENT ? "working" : "idle");
    return { process, state: match ? match.state : cpuState, cpuHistory: history.agents[agentKey(host.label, process.pid)] ?? [] };
  });
}
