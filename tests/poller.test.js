import { strict as assert } from "node:assert";
import { afterEach, beforeEach, test } from "node:test";
import { fakeHerdr, resetFakeHerdr } from "herdr";
import { Poller } from "../mods/herdwatch/poller.js";
import { loadConsoleChoices, readHistory, readMonitorState, readWorktrees, takePollLease } from "../mods/herdwatch/store.js";
import { snapshot } from "./support/snapshots.js";

const POLL_LEASE_KEY = "herdwatch.poller";

/** A stand-in for the GPUI context: spawn runs the task, and the test waits for all of them. */
function fakeContext() {
  const tasks = [];
  return {
    tasks,
    timer: { every: () => {} },
    spawn: (task) => tasks.push(task()),
    settle: () => Promise.all(tasks),
  };
}

/** @param {object} backendSnapshot */
function backendPrints(backendSnapshot) {
  fakeHerdr.execHandler = async (_command, args) => {
    if (args[1] === "snapshot") return { code: 0, stdout: JSON.stringify(backendSnapshot), stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
}

beforeEach(resetFakeHerdr);
afterEach(() => {
  delete globalThis.localStorage;
});

test("a poll publishes the light snapshot, the history and the worktree lists", async () => {
  backendPrints(snapshot());
  const cx = fakeContext();
  new Poller().tick(cx);
  await cx.settle();
  const state = readMonitorState();
  assert.equal(state.error, null);
  assert.deepEqual(state.snapshot.hosts[0].worktrees.items, []);
  assert.equal(readWorktrees().devbox.items.length, 1);
  assert.deepEqual(readHistory().hosts.devbox.cpu, [40]);
  assert.deepEqual(fakeHerdr.execCalls[0].args, ["/home/dev/.config/herdr-app/mods/herdwatch/bin/herdwatch", "snapshot"]);
});

test("a hot host alert sends a notification with a sound", async () => {
  backendPrints(snapshot({ alerts: [{ label: "devbox", cpu_pct: 97, mem_pct: 40, top_process: "cc1plus" }] }));
  const cx = fakeContext();
  new Poller().tick(cx);
  await cx.settle();
  assert.equal(fakeHerdr.notifications[0].title, "herdwatch: devbox is hot");
  assert.deepEqual(fakeHerdr.sounds, ["blocked"]);
});

test("a failed poll keeps the last snapshot next to the error", async () => {
  backendPrints(snapshot());
  const poller = new Poller();
  const firstCx = fakeContext();
  poller.tick(firstCx);
  await firstCx.settle();
  fakeHerdr.execHandler = async () => ({ code: 1, stdout: "", stderr: "ssh: connect to host devbox port 22: timed out\n" });
  const secondCx = fakeContext();
  poller.tick(secondCx);
  await secondCx.settle();
  const state = readMonitorState();
  assert.equal(state.error, "ssh: connect to host devbox port 22: timed out");
  assert.equal(state.snapshot.hosts[0].label, "devbox");
});

test("a due worktree measure runs the backend worktrees command", async () => {
  backendPrints(snapshot({ worktrees_due: true }));
  const cx = fakeContext();
  new Poller().tick(cx);
  await cx.settle();
  await cx.settle();
  assert.deepEqual(fakeHerdr.execCalls.map((call) => call.args[1]), ["snapshot", "worktrees"]);
  assert.equal(fakeHerdr.execCalls[1].options.timeout, 150000);
});

test("a copy does not poll while another copy holds a fresh lease", async () => {
  backendPrints(snapshot());
  const now = Math.floor(Date.now() / 1000);
  fakeHerdr.sharedState.set(POLL_LEASE_KEY, { owner: "the-pill", at: now });
  const cx = fakeContext();
  new Poller().tick(cx);
  await cx.settle();
  assert.equal(fakeHerdr.execCalls.length, 0);
});

test("the poll lease goes to another copy once it is old or broken", () => {
  fakeHerdr.sharedState.set(POLL_LEASE_KEY, { owner: "the-pill", at: 1000 });
  assert.equal(takePollLease("console", 1005), false);
  assert.equal(takePollLease("the-pill", 1005), true);
  assert.equal(takePollLease("console", 1017), true);
  fakeHerdr.sharedState.set(POLL_LEASE_KEY, { owner: 42 });
  assert.equal(takePollLease("the-pill", 1018), true);
});

test("console choices fall back to the defaults for unknown values", () => {
  globalThis.localStorage = { getItem: () => JSON.stringify({ host: "devbox", tab: "graphs", range: 24, filter: "stale" }) };
  assert.deepEqual(loadConsoleChoices(), { host: "devbox", tab: "overview", range: 24, filter: "stale" });
  globalThis.localStorage = { getItem: () => "{broken" };
  assert.deepEqual(loadConsoleChoices(), { host: null, tab: "overview", range: 60, filter: "all" });
});
