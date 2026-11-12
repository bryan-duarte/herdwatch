/** @typedef {import("./types.js").Snapshot} Snapshot */
/** @typedef {import("./types.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./types.js").MonitorHistory} MonitorHistory */
/** @typedef {import("./types.js").HostSeries} HostSeries */
/** @typedef {import("./types.js").HostEvent} HostEvent */

export const HISTORY_SAMPLES = 120;
export const AGENT_HISTORY_SAMPLES = 30;
const EVENT_WINDOW_SECONDS = 600;
const MAX_EVENTS_PER_HOST = 40;

/** @returns {MonitorHistory} */
export const emptyHistory = () => ({ hosts: {}, agents: {}, events: {}, pids: {} });

/** @param {unknown} candidate */
const isPlainObject = (candidate) => candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);

/**
 * Shared state outlives mod updates, so a history in an older shape starts over instead of breaking the poll.
 * @param {unknown} stored
 * @returns {MonitorHistory}
 */
export function historyOrEmpty(stored) {
  if (!isPlainObject(stored)) return emptyHistory();
  const candidate = /** @type {Record<string, unknown>} */ (stored);
  const hasEveryPart = ["hosts", "agents", "events", "pids"].every((part) => isPlainObject(candidate[part]));
  return hasEveryPart ? /** @type {MonitorHistory} */ (stored) : emptyHistory();
}

/** @param {string} label @param {number | null} pid */
export const agentKey = (label, pid) => `${label}:${pid}`;

/**
 * @template T
 * @param {T[] | undefined} list
 * @param {T} value
 * @param {number} limit
 */
const appendLimited = (list, value, limit) => [...(list ?? []), value].slice(-limit);

/** @param {HostSnapshot} host @param {HostSeries | undefined} previous @param {number} now @returns {HostSeries} */
function nextSeries(host, previous, now) {
  const isLive = host.state === "ok";
  return {
    at: appendLimited(previous?.at, now, HISTORY_SAMPLES),
    cpu: appendLimited(previous?.cpu, isLive ? host.cpu_pct : null, HISTORY_SAMPLES),
    mem: appendLimited(previous?.mem, isLive ? host.mem_pct : null, HISTORY_SAMPLES),
    swap: appendLimited(previous?.swap, isLive ? host.swap_pct : null, HISTORY_SAMPLES),
    rx: appendLimited(previous?.rx, isLive ? host.net_rx_rate : null, HISTORY_SAMPLES),
    tx: appendLimited(previous?.tx, isLive ? host.net_tx_rate : null, HISTORY_SAMPLES),
  };
}

/** @param {HostSnapshot} host @param {number[] | undefined} previousPids @param {number} now @returns {HostEvent[]} */
function agentEvents(host, previousPids, now) {
  if (!previousPids || host.state !== "ok") return [];
  const currentPids = host.agents.map((agent) => agent.pid);
  const started = host.agents.filter((agent) => !previousPids.includes(agent.pid))
    .map((agent) => ({ at: now, kind: /** @type {const} */ ("start"), text: `${agent.app} started in ${agent.repository || agent.cwd}` }));
  const finished = previousPids.filter((pid) => !currentPids.includes(pid))
    .map((pid) => ({ at: now, kind: /** @type {const} */ ("done"), text: `agent ${pid} ended` }));
  return [...started, ...finished];
}

/**
 * Adds one poll to the history: host series, agent CPU, and events (agents that started or ended, alerts).
 * @param {MonitorHistory} previous
 * @param {Snapshot} snapshot
 * @param {number} now
 * @returns {MonitorHistory}
 */
export function nextHistory(previous, snapshot, now) {
  const history = emptyHistory();
  snapshot.hosts.forEach((host) => {
    history.hosts[host.label] = nextSeries(host, previous.hosts[host.label], now);
    const alerts = snapshot.alerts.filter((alert) => alert.label === host.label)
      .map((alert) => ({ at: now, kind: /** @type {const} */ ("alert"), text: `${host.label} at CPU ${alert.cpu_pct ?? "?"}% · MEM ${alert.mem_pct ?? "?"}%` }));
    const events = [...(previous.events[host.label] ?? []), ...agentEvents(host, previous.pids[host.label], now), ...alerts];
    history.events[host.label] = events.filter((event) => now - event.at <= EVENT_WINDOW_SECONDS).slice(-MAX_EVENTS_PER_HOST);
    history.pids[host.label] = host.state === "ok" ? host.agents.map((agent) => agent.pid) : previous.pids[host.label] ?? [];
    host.agents.forEach((agent) => {
      const key = agentKey(host.label, agent.pid);
      history.agents[key] = appendLimited(previous.agents[key], agent.cpu, AGENT_HISTORY_SAMPLES);
    });
  });
  return history;
}
