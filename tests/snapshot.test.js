import { strict as assert } from "node:assert";
import { test } from "node:test";
import { monitorStateOrNull, parseSnapshot } from "../mods/herdwatch/snapshot.js";
import { hostSnapshot, snapshot } from "./support/snapshots.js";

test("parseSnapshot accepts a complete snapshot", () => {
  const parsed = parseSnapshot(JSON.stringify(snapshot()));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.snapshot.hosts[0].label, "devbox");
});

test("parseSnapshot names the first problem it finds", () => {
  const cases = [
    ["not json", /snapshot is not JSON/],
    ["[]", /snapshot is not an object/],
    [JSON.stringify(snapshot({ version: 1 })), /snapshot version 1 is not supported/],
    [JSON.stringify(snapshot({ generated_at: "late" })), /snapshot has no time/],
    [JSON.stringify(snapshot({ alerts: null })), /snapshot lists are missing/],
    [JSON.stringify(snapshot({ settings: { ...snapshot().settings, crit: "high" } })), /setting crit is not a number/],
    [JSON.stringify(snapshot({ hosts: [hostSnapshot({ state: "sleeping" })] })), /host devbox has an unknown state/],
    [JSON.stringify(snapshot({ hosts: [hostSnapshot({ ports: null })] })), /host devbox has no ports list/],
    [JSON.stringify(snapshot({ hosts: [hostSnapshot({ worktrees: { state: "ok" } })] })), /host devbox has no worktree data/],
  ];
  for (const [backendOutput, expectedError] of cases) {
    const parsed = parseSnapshot(backendOutput);
    assert.equal(parsed.ok, false, backendOutput);
    assert.match(parsed.error, expectedError);
  }
});

test("monitorStateOrNull drops a snapshot of an older format", () => {
  assert.equal(monitorStateOrNull("text"), null);
  assert.deepEqual(monitorStateOrNull({ snapshot: { version: 1 }, error: "ssh failed" }), { snapshot: null, error: "ssh failed" });
  const current = snapshot();
  assert.deepEqual(monitorStateOrNull({ snapshot: current, error: 7 }), { snapshot: current, error: null });
});
