import { strict as assert } from "node:assert";
import { afterEach, beforeEach, test } from "node:test";
import { fakeHerdr, resetFakeHerdr } from "herdr";
import { Poller } from "../mods/herdwatch/poller.js";
import { loadConsoleChoices, readDocker, readHistory, readMonitorState, readWorktrees, resetPollLease, retireOldSharedKeys, takePollLease } from "../mods/herdwatch/store.js";
import { snapshot } from "./support/snapshots.js";

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

beforeEach(() => {
  resetFakeHerdr();
  resetPollLease();
});
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
  assert.deepEqual([...fakeHerdr.sharedState.keys()].sort(), ["herdwatch.docker", "herdwatch.state", "herdwatch.worktrees"]);
  assert.deepEqual(fakeHerdr.execCalls[0].args, ["/home/dev/.config/herdr-app/mods/herdwatch/bin/herdwatch", "snapshot"]);
});

test("a hot host alert sends a notification with a sound", async () => {
  backendPrints(snapshot({ alerts: [{ kind: "hot", label: "devbox", cpu_pct: 97, mem_pct: 40, top_process: "cc1plus", port: null }] }));
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
  fakeHerdr.execHandler = async () => ({ code: 2, stdout: "", stderr: "herdwatch: unexpected end of file\n" });
  const secondCx = fakeContext();
  poller.tick(secondCx);
  await secondCx.settle();
  const state = readMonitorState();
  assert.deepEqual(state.error, { reason: "mod_bug", detail: "herdwatch: unexpected end of file" });
  assert.equal(state.snapshot.hosts[0].label, "devbox");
  assert.deepEqual(readHistory().hosts.devbox.cpu, [40]);
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
  takePollLease("the-pill", Math.floor(Date.now() / 1000));
  const cx = fakeContext();
  new Poller().tick(cx);
  await cx.settle();
  assert.equal(fakeHerdr.execCalls.length, 0);
});

test("the poll lease goes to another copy once it is old", () => {
  assert.equal(takePollLease("the-pill", 1000), true);
  assert.equal(takePollLease("console", 1005), false);
  assert.equal(takePollLease("the-pill", 1005), true);
  assert.equal(takePollLease("console", 1017), true);
  assert.equal(takePollLease("the-pill", 1018), false);
  assert.equal(takePollLease("the-pill", 1030), true);
  assert.equal(fakeHerdr.sharedState.size, 0);
});

test("the old shared keys are cleared once, and the live keys stay", () => {
  fakeHerdr.sharedState.set("herdwatch.history", { hosts: {} });
  fakeHerdr.sharedState.set("sheepdog.state", { snapshot: null });
  fakeHerdr.sharedState.set("herdwatch.state", { snapshot: null });
  retireOldSharedKeys();
  assert.equal(fakeHerdr.sharedState.get("herdwatch.history"), null);
  assert.equal(fakeHerdr.sharedState.get("sheepdog.state"), null);
  assert.deepEqual(fakeHerdr.sharedState.get("herdwatch.state"), { snapshot: null, history: { hosts: {} } });
});

test("console choices fall back to the defaults for unknown values", () => {
  globalThis.localStorage = { getItem: () => JSON.stringify({ host: "devbox", tab: "graphs", range: 24, filter: "stale", sort: "mem" }) };
  assert.deepEqual(loadConsoleChoices(), { host: "devbox", tab: "overview", range: 24, filter: "stale", sort: "mem" });
  globalThis.localStorage = { getItem: () => JSON.stringify({ sort: "pid" }) };
  assert.equal(loadConsoleChoices().sort, "cpu");
  globalThis.localStorage = { getItem: () => "{broken" };
  assert.deepEqual(loadConsoleChoices(), { host: null, tab: "overview", range: 60, filter: "all", sort: "cpu" });
});

test("a pinned port that stops gives its own notification", async () => {
  backendPrints(snapshot({ alerts: [{ kind: "port_down", label: "devbox", cpu_pct: null, mem_pct: null, top_process: "", port: 3000 }] }));
  const cx = fakeContext();
  new Poller().tick(cx);
  await cx.settle();
  assert.equal(fakeHerdr.notifications[0].title, "herdwatch: :3000 on devbox is down");
  assert.deepEqual(fakeHerdr.sounds, ["blocked"]);
});

test("a due Docker measure runs the backend docker command and the lists go to their own key", async () => {
  backendPrints(snapshot({ docker_due: true }));
  const cx = fakeContext();
  new Poller().tick(cx);
  await cx.settle();
  await cx.settle();
  assert.deepEqual(fakeHerdr.execCalls.map((call) => call.args[1]), ["snapshot", "docker"]);
  assert.equal(readMonitorState().snapshot.hosts[0].docker.containers.length, 0);
  assert.equal(readDocker().devbox.state, "ok");
});

test("a backend that runs past its time limit counts as a timeout", async () => {
  const realNow = Date.now;
  const millisecondsPerCall = 20000;
  let calls = 0;
  Date.now = () => calls++ * millisecondsPerCall;
  try {
    fakeHerdr.execHandler = async () => ({ code: 143, stdout: "", stderr: "" });
    const cx = fakeContext();
    new Poller().tick(cx);
    await cx.settle();
  } finally {
    Date.now = realNow;
  }
  assert.equal(readMonitorState().error.reason, "backend_timeout");
});

test("a known list signature skips the shared read, and a new signature reads again", () => {
  fakeHerdr.sharedState.set("herdwatch.worktrees", { devbox: { state: "ok", measured_at: 900, reason: "", error: "", total_kb: 0, items: [] } });
  const first = readWorktrees("devbox:ok:900:0");
  assert.equal(readWorktrees("devbox:ok:900:0"), first);
  fakeHerdr.sharedState.set("herdwatch.worktrees", { devbox: { state: "ok", measured_at: 960, reason: "", error: "", total_kb: 0, items: [] } });
  assert.equal(readWorktrees("devbox:ok:960:0").devbox.measured_at, 960);
  assert.notEqual(readWorktrees(), readWorktrees());
});

test("a poll stores the signatures of the lists it published", async () => {
  backendPrints(snapshot());
  const cx = fakeContext();
  new Poller().tick(cx);
  await cx.settle();
  const { signatures } = fakeHerdr.sharedState.get("herdwatch.state");
  assert.equal(readWorktrees(signatures.worktrees).devbox.items.length, 1);
  assert.equal(readDocker(signatures.docker).devbox.state, "ok");
});
