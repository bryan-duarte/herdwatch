/** @typedef {import("gpui-kit").Color} Color */

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
export const TOOL_COLORS = {
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
 * A fixed color per agent or worktree tool. A tool without its own color always gets the same accent from its name.
 * @param {string} tool
 */
export function toolColor(tool) {
  if (Object.hasOwn(TOOL_COLORS, tool)) return TOOL_COLORS[/** @type {keyof typeof TOOL_COLORS} */ (tool)];
  const nameSum = [...tool].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return TOOL_ACCENTS[nameSum % TOOL_ACCENTS.length];
}

const HEX_RADIX = 16;
const CHANNEL_MAX = 255;
const HEX_CHANNEL_WIDTH = 2;

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
 * The color at a position (0 to 1) along a gradient of evenly spaced stops.
 * @param {readonly Color[]} stops
 * @param {number} position
 * @returns {Color}
 */
export function gradientAt(stops, position) {
  const clamped = Math.min(1, Math.max(0, position));
  const scaled = clamped * (stops.length - 1);
  const lowerIndex = Math.min(Math.floor(scaled), stops.length - 2);
  const fraction = scaled - lowerIndex;
  const lower = channels(stops[lowerIndex]);
  const upper = channels(stops[lowerIndex + 1]);
  return toColor(lower.map((channel, index) => channel + (upper[index] - channel) * fraction));
}
