import { strict as assert } from "node:assert";
import { test } from "node:test";
import { BACKEND_GUIDANCE, FAILURE_GUIDANCE, HOST_PROBLEM_GUIDANCE, configProblemLine, hostFailureGuidance, hostProblemGuidance, hostTabTooltip, measureGuidance } from "../mods/herdwatch/failure-guidance.js";
import { SETTINGS, hostSnapshot } from "./support/snapshots.js";

const FAILURE_REASONS = ["timeout", "hostkey", "tailscale_check", "login", "dns", "refused", "unreachable", "ssh_config", "remote_shell",
  "probe_format", "parse_failed", "unknown"];
const HOST_PROBLEM_REASONS = ["missing_tools", "unsupported_os", "ports_hidden"];
const BACKEND_FAILURE_REASONS = ["backend_timeout", "backend_missing", "bad_output", "mod_bug", "runtime_dir"];

test("every reason code has a summary and a next step", () => {
  assert.deepEqual(Object.keys(FAILURE_GUIDANCE).sort(), [...FAILURE_REASONS].sort());
  assert.deepEqual(Object.keys(HOST_PROBLEM_GUIDANCE).sort(), [...HOST_PROBLEM_REASONS].sort());
  assert.deepEqual(Object.keys(BACKEND_GUIDANCE).sort(), [...BACKEND_FAILURE_REASONS].sort());
  for (const reason of FAILURE_REASONS) {
    const { summary, nextStep } = hostFailureGuidance(hostSnapshot({ state: "down", reason }), SETTINGS);
    assert.ok(summary.length > 0 && nextStep.length > 0, reason);
  }
});

test("a changed host key names the command that fixes it", () => {
  const host = hostSnapshot({ state: "auth", reason: "hostkey", target: "dev@devbox.lan:2222" });
  assert.deepEqual(hostFailureGuidance(host, SETTINGS), {
    summary: "The host key of devbox changed since the last login.",
    nextStep: "If you expected this, run ssh-keygen -R devbox.lan, then ssh dev@devbox.lan:2222 once.",
  });
});

test("a host without a reason gets the general advice for its state", () => {
  assert.equal(hostFailureGuidance(hostSnapshot({ state: "auth", reason: "" }), SETTINGS).summary, "devbox refused the SSH login.");
  assert.equal(hostFailureGuidance(hostSnapshot({ state: "down", reason: "" }), SETTINGS).summary, "devbox did not answer.");
});

test("a config problem names the file, the line, the value and what Herdwatch uses instead", () => {
  const problem = { file: "settings.conf", line: 4, key: "SSH_TIMEOUT", value: "0", reason: "not_a_positive_integer" };
  assert.equal(configProblemLine(problem, SETTINGS), "settings.conf line 4: SSH_TIMEOUT=0 is not a positive number. Herdwatch uses 3.");
  const pin = { file: "pins.conf", line: 2, key: "nope", value: "22", reason: "unknown_host" };
  assert.equal(configProblemLine(pin, SETTINGS), "pins.conf line 2: nope is not a host in hosts.conf. Herdwatch skips this pin.");
  const warn = { file: "settings.conf", line: 3, key: "WARN", value: "95", reason: "above_crit" };
  assert.equal(configProblemLine(warn, SETTINGS), "settings.conf line 3: WARN=95 is above CRIT. Herdwatch uses 90.");
});

test("a host without ss says that its ports are hidden", () => {
  assert.deepEqual(hostProblemGuidance({ reason: "ports_hidden", detail: "ss" }), { summary: "Ports are hidden: ss is not installed.", nextStep: "Install ss on the host." });
});

test("a measure that misses a root names the setting to fix", () => {
  const worktrees = { state: "ok", measured_at: 900, reason: "missing_root", error: "~/code", total_kb: 0, items: [] };
  assert.equal(measureGuidance("worktree", worktrees, hostSnapshot(), SETTINGS).nextStep, "Fix WORKTREE_ROOTS in settings.conf.");
});

test("the host tab tooltip shows the SSH round trip, or how long the host is down and why", () => {
  assert.equal(hostTabTooltip(hostSnapshot({ rtt_ms: 42 }), 0, SETTINGS), "Show devbox (1) · ssh 42 ms");
  assert.equal(hostTabTooltip(hostSnapshot({ rtt_ms: null }), 0, SETTINGS), "Show devbox (1)");
  const downHost = hostSnapshot({ state: "down", reason: "dns", target: "dev@devbox.lan", down_since: 1000 });
  assert.equal(hostTabTooltip(downHost, 1, SETTINGS, 1720), "Show devbox (2) · down for 12m · The name devbox.lan does not resolve.");
});
