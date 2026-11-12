import { ageSince, nowInSeconds } from "./format.js";

const SECONDS_PER_MINUTE = 60;

/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").HostHealth} HostHealth */
/** @typedef {import("./schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("./schemas.js").PercentLevel} PercentLevel */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */

/**
 * @param {number | null} percent
 * @param {MonitorSettings} settings
 * @returns {PercentLevel}
 */
export function percentLevel(percent, settings) {
  if (!Number.isFinite(percent)) return "normal";
  if (percent >= settings.crit) return "critical";
  if (percent >= settings.warn) return "warning";
  return "normal";
}

/**
 * A reachable host is as healthy as its busier resource, CPU or memory.
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 * @returns {HostHealth}
 */
export function hostHealth(host, settings) {
  if (host.state !== "ok") return host.state;
  return percentLevel(Math.max(host.cpu_pct ?? 0, host.mem_pct ?? 0), settings);
}

/**
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 * @param {number} now
 */
export function isStale(host, settings, now = nowInSeconds()) {
  return !Number.isFinite(host.updated_at) || now - host.updated_at > settings.stale_seconds;
}

/** @param {Snapshot} snapshot @param {number} now */
export const isPollLate = (snapshot, now) => now - snapshot.generated_at > snapshot.settings.stale_seconds;

/**
 * What the clock alone changes on screen: the late-poll notice and its age, the stale hosts and the ages in whole
 * minutes. Other ages under a minute change with each poll, and each poll redraws the console.
 * @param {Snapshot | null} snapshot
 * @param {number} now
 */
export function clockKey(snapshot, now) {
  const minute = Math.floor(now / SECONDS_PER_MINUTE);
  if (!snapshot) return `none:${minute}`;
  const staleHostCount = snapshot.hosts.filter((host) => isStale(host, snapshot.settings, now)).length;
  const lateAge = isPollLate(snapshot, now) ? ageSince(snapshot.generated_at, now) : "on time";
  return `${lateAge}:${staleHostCount}:${minute}`;
}
