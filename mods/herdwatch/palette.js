/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("./schemas.js").HostHealth} HostHealth */
/** @typedef {import("./schemas.js").PercentLevel} PercentLevel */

export const TOKYO_NIGHT = /** @type {const} */ ({
  background: "#1a1b26",
  backgroundDark: "#16161e",
  highlight: "#292e42",
  border: "#3b4261",
  terminalBlack: "#414868",
  comment: "#565f89",
  dim: "#737aa2",
  foregroundDark: "#a9b1d6",
  foreground: "#c0caf5",
  blue: "#7aa2f7",
  cyan: "#7dcfff",
  teal: "#73daca",
  green: "#9ece6a",
  yellow: "#e0af68",
  orange: "#ff9e64",
  red: "#f7768e",
  magenta: "#bb9af7",
  purple: "#9d7cd8",
});

export const GRADIENTS = /** @type {const} */ ({
  cpu: [TOKYO_NIGHT.green, TOKYO_NIGHT.yellow, TOKYO_NIGHT.red],
  memory: [TOKYO_NIGHT.cyan, TOKYO_NIGHT.blue, TOKYO_NIGHT.magenta],
  swap: [TOKYO_NIGHT.purple, TOKYO_NIGHT.magenta, TOKYO_NIGHT.red],
  disk: [TOKYO_NIGHT.teal, TOKYO_NIGHT.yellow, TOKYO_NIGHT.red],
  storage: [TOKYO_NIGHT.teal, TOKYO_NIGHT.orange, TOKYO_NIGHT.red],
});

/** @type {Record<string, Color>} */
const TOOL_COLORS = {
  claude: TOKYO_NIGHT.orange,
  codex: TOKYO_NIGHT.green,
  cursor: TOKYO_NIGHT.blue,
  conductor: TOKYO_NIGHT.magenta,
  herdr: TOKYO_NIGHT.cyan,
  omp: TOKYO_NIGHT.yellow,
  "vibe-kanban": TOKYO_NIGHT.teal,
  git: TOKYO_NIGHT.dim,
};

const TOOL_ACCENTS = [TOKYO_NIGHT.blue, TOKYO_NIGHT.cyan, TOKYO_NIGHT.teal, TOKYO_NIGHT.green, TOKYO_NIGHT.yellow,
  TOKYO_NIGHT.orange, TOKYO_NIGHT.magenta, TOKYO_NIGHT.purple];

/**
 * A tool without its own color gets an accent picked from its name, so it keeps the same color on every poll.
 * @param {string} tool
 */
export function toolColor(tool) {
  if (Object.hasOwn(TOOL_COLORS, tool)) return TOOL_COLORS[tool];
  const nameSum = [...tool].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return TOOL_ACCENTS[nameSum % TOOL_ACCENTS.length];
}

/** @type {Record<HostHealth, Color>} */
const HEALTH_COLORS = {
  down: TOKYO_NIGHT.red,
  auth: TOKYO_NIGHT.yellow,
  pending: TOKYO_NIGHT.comment,
  critical: TOKYO_NIGHT.red,
  warning: TOKYO_NIGHT.yellow,
  normal: TOKYO_NIGHT.green,
};

/** @param {HostHealth} health */
export const healthColor = (health) => HEALTH_COLORS[health];

/**
 * @param {PercentLevel} level
 * @param {Color} normalColor
 * @returns {Color}
 */
export function levelColor(level, normalColor = TOKYO_NIGHT.foreground) {
  if (level === "normal") return normalColor;
  return HEALTH_COLORS[level];
}

const HEX_RADIX = 16;
const CHANNEL_MAX = 255;
const HEX_CHANNEL_WIDTH = 2;
const MAX_CACHED_POSITIONS = 512;
/** @type {WeakMap<readonly Color[], number[][]>} */
const channelsOfStops = new WeakMap();
/** @type {WeakMap<readonly Color[], Map<number, Color>>} */
const colorsOfGradient = new WeakMap();

/** @param {Color} color @returns {number[]} */
function channels(color) {
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + HEX_CHANNEL_WIDTH), HEX_RADIX));
}

/** @param {number[]} rgb @returns {Color} */
function toColor(rgb) {
  const hex = rgb.map((channel) => Math.round(Math.min(CHANNEL_MAX, Math.max(0, channel))).toString(HEX_RADIX).padStart(HEX_CHANNEL_WIDTH, "0"));
  return /** @type {Color} */ (`#${hex.join("")}`);
}

/**
 * The gradients are fixed arrays, so each one is parsed once.
 * @param {readonly Color[]} stops
 */
function stopChannels(stops) {
  const known = channelsOfStops.get(stops);
  if (known) return known;
  const parsed = stops.map(channels);
  channelsOfStops.set(stops, parsed);
  return parsed;
}

/**
 * @param {readonly Color[]} stops
 * @param {number} clampedPosition
 * @returns {Color}
 */
function mixedColor(stops, clampedPosition) {
  const parsed = stopChannels(stops);
  const scaled = clampedPosition * (stops.length - 1);
  const lowerIndex = Math.min(Math.floor(scaled), stops.length - 2);
  const fraction = scaled - lowerIndex;
  const lower = parsed[lowerIndex];
  const upper = parsed[lowerIndex + 1];
  return toColor(lower.map((channel, index) => channel + (upper[index] - channel) * fraction));
}

/** @param {readonly Color[]} stops */
function cachedColorsOf(stops) {
  const known = colorsOfGradient.get(stops);
  if (known) return known;
  /** @type {Map<number, Color>} */
  const colors = new Map();
  colorsOfGradient.set(stops, colors);
  return colors;
}

/**
 * The color at a position (0 to 1) along a gradient of evenly spaced stops.
 * Meters and charts ask for the same positions on every render, so each answer is kept.
 * @param {readonly Color[]} stops
 * @param {number} position
 * @returns {Color}
 */
export function gradientAt(stops, position) {
  const clampedPosition = Math.min(1, Math.max(0, position));
  const colors = cachedColorsOf(stops);
  const known = colors.get(clampedPosition);
  if (known) return known;
  if (colors.size >= MAX_CACHED_POSITIONS) colors.clear();
  const color = mixedColor(stops, clampedPosition);
  colors.set(clampedPosition, color);
  return color;
}
