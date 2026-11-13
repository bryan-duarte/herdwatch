import { isRecord } from "./snapshot.js";

/** @typedef {import("./schemas.js").ChartMarker} ChartMarker */
/** @typedef {import("./schemas.js").HostEvent} HostEvent */
/** @typedef {import("./schemas.js").HostSeries} HostSeries */
/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").MonitorHistory} MonitorHistory */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */

export const SECONDS_PER_SAMPLE = 5;
export const CHART_RANGE_SAMPLES = [24, 60, 120];
export const DEFAULT_CHART_RANGE_SAMPLES = 60;
export const HISTORY_SAMPLES = Math.max(...CHART_RANGE_SAMPLES);
export const AGENT_HISTORY_SAMPLES = 30;
const EVENT_WINDOW_SECONDS = 600;
const MAX_EVENTS_PER_HOST = 40;
const HISTORY_PARTS = ["hosts", "agents", "events", "pids"];

/** @returns {MonitorHistory} */
export const emptyHistory = () => ({ hosts: {}, agents: {}, events: {}, pids: {} });

/**
 * Shared state outlives mod updates, so a history in an older shape starts over instead of breaking the poll.
 * @param {unknown} stored
 * @returns {MonitorHistory}
 */
export function historyOrEmpty(stored) {
  if (!isRecord(stored)) return emptyHistory();
  const hasEveryPart = HISTORY_PARTS.every((part) => isRecord(stored[part]));
  return hasEveryPart ? /** @type {MonitorHistory} */ (stored) : emptyHistory();
}

/** @param {string} label @param {number | null} pid */
export const agentKey = (label, pid) => `${label}:${pid}`;

/**
 * @template T
 * @param {T[] | undefined} list
 * @param {T} sample
 * @param {number} limit
 */
const appendLimited = (list, sample, limit) => [...(list ?? []), sample].slice(-limit);

/**
 * A host that did not answer adds a gap, so its chart shows when it was down.
 * @param {(number | null)[] | undefined} series
 * @param {HostSnapshot} host
 * @param {number | null} reading
 */
const appendReading = (series, host, reading) => appendLimited(series, host.state === "ok" ? reading : null, HISTORY_SAMPLES);

/** @param {HostSnapshot} host @param {HostSeries | undefined} previous @param {number} now @returns {HostSeries} */
function nextSeries(host, previous, now) {
  return {
    at: appendLimited(previous?.at, now, HISTORY_SAMPLES),
    cpu: appendReading(previous?.cpu, host, host.cpu_pct),
    mem: appendReading(previous?.mem, host, host.mem_pct),
    rx: appendReading(previous?.rx, host, host.net_rx_rate),
    tx: appendReading(previous?.tx, host, host.net_tx_rate),
  };
}

/** @param {HostSnapshot} host @param {number[] | undefined} previousPids @param {number} now @returns {HostEvent[]} */
function agentEvents(host, previousPids, now) {
  if (!previousPids || host.state !== "ok") return [];
  const currentPids = host.agents.map((agent) => agent.pid);
  /** @type {HostEvent[]} */
  const started = host.agents.filter((agent) => !previousPids.includes(agent.pid))
    .map((agent) => ({ at: now, kind: "start", text: `${agent.app} started in ${agent.repository || agent.cwd}` }));
  /** @type {HostEvent[]} */
  const ended = previousPids.filter((pid) => !currentPids.includes(pid))
    .map((pid) => ({ at: now, kind: "done", text: `agent ${pid} ended` }));
  return [...started, ...ended];
}

/** @param {Snapshot} snapshot @param {string} label @param {number} now @returns {HostEvent[]} */
function alertEvents(snapshot, label, now) {
  return snapshot.alerts.filter((alert) => alert.label === label)
    .map((alert) => ({ at: now, kind: "alert", text: `${label} at CPU ${alert.cpu_pct ?? "?"}% · MEM ${alert.mem_pct ?? "?"}%` }));
}

/** @param {HostEvent[]} events @param {number} now */
const recentEvents = (events, now) => events.filter((event) => now - event.at <= EVENT_WINDOW_SECONDS).slice(-MAX_EVENTS_PER_HOST);

/**
 * Adds one poll to the history: host series, agent CPU, and events (agents that started or ended, alerts).
 * @param {MonitorHistory} previous
 * @param {Snapshot} snapshot
 * @param {number} now
 * @returns {MonitorHistory}
 */
export function nextHistory(previous, snapshot, now) {
  const history = emptyHistory();
  for (const host of snapshot.hosts) {
    const { label } = host;
    history.hosts[label] = nextSeries(host, previous.hosts[label], now);
    const events = [...(previous.events[label] ?? []), ...agentEvents(host, previous.pids[label], now), ...alertEvents(snapshot, label, now)];
    history.events[label] = recentEvents(events, now);
    history.pids[label] = host.state === "ok" ? host.agents.map((agent) => agent.pid) : previous.pids[label] ?? [];
    for (const agent of host.agents) {
      const key = agentKey(label, agent.pid);
      history.agents[key] = appendLimited(previous.agents[key], agent.cpu, AGENT_HISTORY_SAMPLES);
    }
  }
  return history;
}

/**
 * Puts the samples at the right end of a window that is always rangeSamples wide, so new data grows from the right.
 * @param {(number | null)[] | undefined} samples
 * @param {number} rangeSamples
 * @returns {(number | null)[]}
 */
export function samplesInRange(samples, rangeSamples) {
  const recent = (samples ?? []).slice(-rangeSamples);
  const missingCount = Math.max(0, rangeSamples - recent.length);
  return [...Array(missingCount).fill(null), ...recent];
}

/**
 * Places each event of the host on the chart window by its time, between the samples around it.
 * @param {MonitorHistory} history
 * @param {string} label
 * @param {number} rangeSamples
 * @returns {ChartMarker[]}
 */
export function eventMarkers(history, label, rangeSamples) {
  const times = (history.hosts[label]?.at ?? []).slice(-rangeSamples);
  if (times.length < 2) return [];
  const missingCount = rangeSamples - times.length;
  const lastIndex = rangeSamples - 1;
  const start = times[0];
  const end = times[times.length - 1];
  return (history.events[label] ?? []).filter((event) => event.at >= start && event.at <= end)
    .map((event) => {
      const sampleIndex = missingCount + ((event.at - start) / (end - start)) * (times.length - 1);
      return { position: sampleIndex / lastIndex, kind: event.kind, text: event.text };
    });
}
