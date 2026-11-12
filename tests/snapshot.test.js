import { strict as assert } from "node:assert";
import { test } from "node:test";
import { monitorStateOrNull, parseSnapshot } from "../mods/herdwatch/snapshot.js";
import { hostSnapshot, snapshot } from "./support/snapshots.js";

test("parseSnapshot accepts a complete snapshot", () => {
  const parsed = parseSnapshot(JSON.stringify(snapshot()));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.snapshot.hosts[0].label, "devbox");
});

test("parseSnapshot names the first problem of the snapshot as bad output", () => {
  const cases = [
    ["not json", /snapshot is not JSON/],
    ["[]", /snapshot is not an object/],
    [JSON.stringify(snapshot({ version: 2 })), /snapshot version 2 is not supported/],
    [JSON.stringify(snapshot({ generated_at: "late" })), /snapshot has no time/],
    [JSON.stringify(snapshot({ alerts: null })), /snapshot lists are missing/],
    [JSON.stringify(snapshot({ problems: null })), /snapshot lists are missing/],
    [JSON.stringify(snapshot({ settings: { ...snapshot().settings, crit: "high" } })), /setting crit is not a number/],
  ];
  for (const [backendOutput, expectedDetail] of cases) {
    const parsed = parseSnapshot(backendOutput);
    assert.equal(parsed.ok, false, backendOutput);
    assert.equal(parsed.failure.reason, "bad_output");
    assert.match(parsed.failure.detail, expectedDetail);
  }
});

test("parseSnapshot drops one broken host and keeps the others, with a problem that names it", () => {
  const cases = [
    [hostSnapshot({ label: "broken", state: "sleeping" }), /host broken has an unknown state/],
    [hostSnapshot({ label: "broken", ports: null }), /host broken has no ports list/],
    [hostSnapshot({ label: "broken", worktrees: { state: "ok" } }), /host broken has no worktree data/],
    [hostSnapshot({ label: "broken", docker: { state: "ok" } }), /host broken has no Docker data/],
  ];
  for (const [brokenHost, expectedValue] of cases) {
    const parsed = parseSnapshot(JSON.stringify(snapshot({ hosts: [hostSnapshot(), brokenHost] })));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.snapshot.hosts.map((host) => host.label), ["devbox"]);
    const [problem] = parsed.snapshot.problems;
    assert.equal(problem.reason, "broken_host");
    assert.equal(problem.key, "broken");
    assert.match(problem.value, expectedValue);
  }
});

test("monitorStateOrNull drops a snapshot of an older format and an error of an older shape", () => {
  assert.equal(monitorStateOrNull("text"), null);
  assert.deepEqual(monitorStateOrNull({ snapshot: { version: 2 }, error: "ssh failed" }), { snapshot: null, error: null });
  const current = snapshot();
  const failure = { reason: "backend_timeout", detail: "" };
  assert.deepEqual(monitorStateOrNull({ snapshot: current, error: failure }), { snapshot: current, error: failure });
  assert.deepEqual(monitorStateOrNull({ snapshot: current, error: { reason: "nonsense", detail: "" } }), { snapshot: current, error: null });
});
