import { agents, panes, spaces } from "herdr";
import { agentKey } from "./history.js";

/** @typedef {import("./schemas.js").AgentProcess} AgentProcess */
/** @typedef {import("./schemas.js").AgentState} AgentState */
/** @typedef {import("./schemas.js").AgentView} AgentView */
/** @typedef {import("./schemas.js").HerdrAgent} HerdrAgent */
/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").MonitorHistory} MonitorHistory */

const WORKING_CPU_PERCENT = 3;
const KNOWN_STATES = new Set(["working", "blocked", "idle", "done"]);
const GENERIC_PROGRAM_KEYS = new Set(["agent", "program", "shell"]);
const APP_NAME_SUFFIXES = [/-cli$/, /-code$/, /-agent$/];

/** @param {string | null | undefined} name */
const normalizedApp = (name) => APP_NAME_SUFFIXES.reduce((app, suffix) => app.replace(suffix, ""), (name ?? "").toLowerCase());

/**
 * The key of Herdr.app's program table ("cursor" for cursor-agent, "kimi" for kimi-code), which the probe also prints.
 * An agent without its own table entry falls back to the app name it reports.
 * @param {{ app: string | null, program?: { key?: string, name?: string } }} agent
 */
function herdrAppKey(agent) {
  const programKey = agent.program?.key;
  const hasOwnProgramKey = Boolean(programKey) && !GENERIC_PROGRAM_KEYS.has(programKey);
  return hasOwnProgramKey ? programKey : normalizedApp(agent.app ?? agent.program?.name);
}

/** @returns {HerdrAgent[]} */
export function herdrAgents() {
  const machineOfSpace = new Map(spaces().map((space) => [space.id, space.machine ?? null]));
  const folderOfPane = new Map(panes().map((pane) => [pane.pane, pane.cwd ?? ""]));
  return agents()
    .filter((agent) => KNOWN_STATES.has(agent.status))
    .map((agent) => ({
      machine: machineOfSpace.get(agent.space) ?? null,
      app: herdrAppKey(agent),
      cwd: folderOfPane.get(agent.pane) ?? "",
      state: /** @type {AgentState} */ (agent.status),
    }));
}

/** @param {string} sshTarget */
const hostNameOfTarget = (sshTarget) => sshTarget.replace(/^ssh:\/\//, "").replace(/^[^@]*@/, "").replace(/:\d+$/, "");

/** @param {HostSnapshot} host @param {string | null} machine */
function isSameMachine(host, machine) {
  if (!machine) return false;
  return machine === host.label || machine === host.target || machine === hostNameOfTarget(host.target);
}

/** @param {string} reportedApp @param {string} processApp */
function isSameApp(reportedApp, processApp) {
  const app = normalizedApp(processApp);
  return reportedApp.startsWith(app) || app.startsWith(reportedApp);
}

/** @param {HerdrAgent} reported @param {AgentProcess} process @param {HostSnapshot} host */
const isSameAgent = (reported, process, host) =>
  isSameMachine(host, reported.machine) && reported.cwd === process.cwd && isSameApp(reported.app, process.app);

/** @param {AgentProcess} process @returns {AgentState} */
const stateFromCpu = (process) => ((process.cpu ?? 0) >= WORKING_CPU_PERCENT ? "working" : "idle");

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
    const match = reported.find((agent) => isSameAgent(agent, process, host));
    return {
      process,
      state: match ? match.state : stateFromCpu(process),
      cpuHistory: history.agents[agentKey(host.label, process.pid)] ?? [],
    };
  });
}
