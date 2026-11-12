/**
 * @typedef {object} AgentMark
 * @property {string} name   the name people know the agent by
 * @property {string} path   from Herdr's home folder, as svg() and image() want it
 * @property {boolean} tint  true for a one-color glyph drawn in the text color, false for a picture
 * @property {boolean} isDefault
 */

const OWN_MARKS_FOLDER = "mods/herdwatch/icons/agents";

/** @param {string} key @param {string} name @param {boolean} tint @returns {AgentMark} */
export const herdrMark = (key, name, tint) => ({ name, path: `icons/${key}.svg`, tint, isDefault: false });

/** @param {string} file @param {string} name @param {boolean} tint @returns {AgentMark} */
const ownMark = (file, name, tint) => ({ name, path: `${OWN_MARKS_FOLDER}/${file}`, tint, isDefault: false });

/** @type {Record<string, AgentMark>} */
const AGENT_MARKS = {
  claude: herdrMark("claude", "Claude Code", false),
  codex: herdrMark("codex", "Codex", false),
  cursor: herdrMark("cursor", "Cursor", true),
  opencode: herdrMark("opencode", "OpenCode", true),
  gemini: herdrMark("gemini", "Gemini CLI", true),
  antigravity: herdrMark("antigravity", "Antigravity", false),
  amp: herdrMark("amp", "Amp", false),
  copilot: herdrMark("copilot", "Copilot", true),
  crush: herdrMark("crush", "Crush", false),
  kimi: herdrMark("kimi", "Kimi", false),
  kiro: herdrMark("kiro", "Kiro", false),
  grok: herdrMark("grok", "Grok", true),
  pi: herdrMark("pi", "Pi", true),
  pig: herdrMark("pig", "PiG", false),
  qoder: herdrMark("qoder", "Qoder", true),
  hermes: herdrMark("hermes", "Hermes", true),
  mastracode: herdrMark("mastracode", "Mastra Code", true),
  "dsh-tui": herdrMark("dsh-tui", "DeepSeek Harness", true),
  git: herdrMark("git", "git", true),
  goose: ownMark("goose.svg", "Goose", true),
  cline: ownMark("cline.svg", "Cline", true),
  kilo: ownMark("kilo.svg", "Kilo Code", true),
  qwen: ownMark("qwen.svg", "Qwen Code", true),
  devin: ownMark("devin.svg", "Devin", false),
  openhands: ownMark("openhands.svg", "OpenHands", false),
  jules: ownMark("jules.svg", "Jules", true),
  continue: ownMark("continue.svg", "Continue", true),
  droid: ownMark("droid.svg", "Droid", true),
  omp: ownMark("omp.svg", "oh-my-pi", false),
  aider: ownMark("aider.png", "Aider", false),
  plandex: ownMark("plandex.png", "Plandex", false),
};

/** @type {Record<string, string>} */
const COMMAND_ALIASES = {
  "cursor-agent": "cursor",
  "kiro-cli": "kiro",
  agy: "antigravity",
  qodercli: "qoder",
  kilocode: "kilo",
  pdx: "plandex",
  cn: "continue",
};

/**
 * The mark for an agent key ("claude"), a command name ("cursor-agent") or a worktree tool ("git").
 * A name without a mark gets the Herdwatch sheep.
 * @param {string} agentName
 * @returns {AgentMark}
 */
export function agentMark(agentName) {
  const key = Object.hasOwn(COMMAND_ALIASES, agentName) ? COMMAND_ALIASES[agentName] : agentName;
  if (Object.hasOwn(AGENT_MARKS, key)) return AGENT_MARKS[key];
  return { name: agentName, path: `${OWN_MARKS_FOLDER}/default.svg`, tint: true, isDefault: true };
}
