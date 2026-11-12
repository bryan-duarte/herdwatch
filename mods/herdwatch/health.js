import { nowInSeconds } from "./format.js";

/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").HostHealth} HostHealth */
/** @typedef {import("./schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("./schemas.js").PercentLevel} PercentLevel */

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
