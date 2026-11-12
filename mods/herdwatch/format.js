const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const MILLISECONDS_PER_SECOND = 1000;
const KIB_PER_MIB = 1024;
const KIB_PER_GIB = 1048576;
const KIB_PER_TIB = 1073741824;
const MIB_PER_GIB = 1024;
const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = 1048576;
const BYTES_PER_GIB = 1073741824;
const RATE_DECIMALS_BELOW = 100;

export const nowInSeconds = () => Math.floor(Date.now() / MILLISECONDS_PER_SECOND);

/** @param {number} seconds */
export const minutesIn = (seconds) => seconds / SECONDS_PER_MINUTE;

/** @param {number} seconds */
export const minutesText = (seconds) => `${minutesIn(seconds)}m`;

/** @param {number} seconds */
export function age(seconds) {
  if (seconds < SECONDS_PER_MINUTE) return `${Math.round(seconds)}s`;
  if (seconds < SECONDS_PER_HOUR) return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m`;
  if (seconds < SECONDS_PER_DAY) return `${Math.floor(seconds / SECONDS_PER_HOUR)}h`;
  return `${Math.floor(seconds / SECONDS_PER_DAY)}d`;
}

/** @param {number | null} seconds */
export const ageOrUnknown = (seconds) => (Number.isFinite(seconds) ? age(seconds) : "?");

/** @param {number | null} epochSeconds @param {number} now */
export const ageSince = (epochSeconds, now = nowInSeconds()) => (Number.isFinite(epochSeconds) ? `${age(Math.max(0, now - epochSeconds))} ago` : "never");

/** @param {number | null} epochSeconds @param {number} now */
export function daysSince(epochSeconds, now = nowInSeconds()) {
  const hasTime = Number.isFinite(epochSeconds) && epochSeconds > 0;
  return hasTime ? Math.floor((now - epochSeconds) / SECONDS_PER_DAY) : null;
}

/** @param {number | null} kib */
export function storageSize(kib) {
  if (!Number.isFinite(kib)) return "?";
  if (kib >= KIB_PER_TIB) return `${(kib / KIB_PER_TIB).toFixed(1)} TiB`;
  if (kib >= KIB_PER_GIB) return `${(kib / KIB_PER_GIB).toFixed(1)} GiB`;
  return `${Math.round(kib / KIB_PER_MIB)} MiB`;
}

/** @param {number | null} kib */
export const kibAsGib = (kib) => (Number.isFinite(kib) ? (kib / KIB_PER_GIB).toFixed(1) : "?");

/** @param {number | null} mib */
export const mibAsGib = (mib) => ((mib ?? 0) / MIB_PER_GIB).toFixed(1);

/** @param {number | null} bytesPerSecond */
export function byteRate(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond)) return "?";
  if (bytesPerSecond >= BYTES_PER_GIB) return `${(bytesPerSecond / BYTES_PER_GIB).toFixed(1)} GB/s`;
  if (bytesPerSecond >= BYTES_PER_MIB) {
    const megabytes = bytesPerSecond / BYTES_PER_MIB;
    return `${megabytes < RATE_DECIMALS_BELOW ? megabytes.toFixed(1) : Math.round(megabytes)} MB/s`;
  }
  return `${Math.round(bytesPerSecond / BYTES_PER_KIB)} KB/s`;
}

/** @param {number | null} percent */
export const percentText = (percent) => (Number.isFinite(percent) ? `${Math.round(percent)}%` : "?");

/** @param {string} path @param {string} home */
export function homeRelative(path, home) {
  if (!path) return "";
  const isInHome = Boolean(home) && (path === home || path.startsWith(`${home}/`));
  return isInHome ? `~${path.slice(home.length)}` : path;
}
