import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { agentMark } from "../mods/herdwatch/agent-marks.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROBE_AGENT_KEYS = ["claude", "codex", "cursor", "opencode", "aider", "gemini", "antigravity", "omp", "amp", "goose", "droid",
  "copilot", "crush", "qwen", "kiro", "pi", "pig", "kimi", "cline", "plandex", "kilo", "continue", "grok", "devin", "hermes", "qoder",
  "mastracode", "jules", "openhands", "dsh-tui"];

test("agentMark gives Herdr's mark for an agent in Herdr's program table", () => {
  assert.deepEqual(agentMark("claude"), { name: "Claude Code", path: "icons/claude.svg", tint: false, isDefault: false });
  assert.equal(agentMark("cursor").tint, true);
});

test("agentMark reads command names and the agent keys the probe prints", () => {
  assert.equal(agentMark("cursor-agent").path, "icons/cursor.svg");
  assert.equal(agentMark("agy").name, "Antigravity");
  assert.equal(agentMark("pdx").path, "mods/herdwatch/icons/agents/plandex.png");
});

test("agentMark gives the sheep to a name without a mark", () => {
  assert.deepEqual(agentMark("letta"), { name: "letta", path: "mods/herdwatch/icons/agents/default.svg", tint: true, isDefault: true });
});

test("every mark the mod ships is in the repo", () => {
  for (const key of [...PROBE_AGENT_KEYS, "letta"]) {
    const { path } = agentMark(key);
    if (path.startsWith("mods/")) assert.ok(existsSync(join(REPO_ROOT, path)), path);
  }
});

test("every Herdr mark is in Herdr's icon folder, when Herdr is installed here", { skip: !existsSync(join(homedir(), ".config/herdr-app/icons")) }, () => {
  for (const key of [...PROBE_AGENT_KEYS, "git"]) {
    const { path } = agentMark(key);
    if (path.startsWith("icons/")) assert.ok(existsSync(join(homedir(), ".config/herdr-app", path)), path);
  }
});
