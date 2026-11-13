import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AGENT_HISTORY_SAMPLES, HISTORY_SAMPLES, emptyHistory, eventMarkers, historyOrEmpty, nextHistory, samplesInRange } from "../mods/herdwatch/history.js";
import { agentProcess, hostSnapshot, snapshot } from "./support/snapshots.js";

test("nextHistory adds one sample per host and leaves a gap for a host that is down", () => {
  const first = nextHistory(emptyHistory(), snapshot(), 1000);
  const second = nextHistory(first, snapshot({ hosts: [hostSnapshot({ state: "down" })] }), 1005);
  assert.deepEqual(second.hosts.devbox.at, [1000, 1005]);
  assert.deepEqual(second.hosts.devbox.cpu, [40, null]);
  assert.deepEqual(second.hosts.devbox.rx, [500, null]);
});

test("nextHistory keeps at most HISTORY_SAMPLES samples and AGENT_HISTORY_SAMPLES agent samples", () => {
  let history = emptyHistory();
  const busy = snapshot({ hosts: [hostSnapshot({ agents: [agentProcess()] })] });
  for (let poll = 0; poll < HISTORY_SAMPLES + 5; poll += 1) history = nextHistory(history, busy, 1000 + poll);
  assert.equal(history.hosts.devbox.cpu.length, HISTORY_SAMPLES);
  assert.equal(history.agents["devbox:4100"].length, AGENT_HISTORY_SAMPLES);
});

test("nextHistory records agents that start and end, and hot host alerts", () => {
  const idle = nextHistory(emptyHistory(), snapshot(), 1000);
  const started = nextHistory(idle, snapshot({ hosts: [hostSnapshot({ agents: [agentProcess()] })] }), 1005);
  const hot = snapshot({ alerts: [{ label: "devbox", cpu_pct: 95, mem_pct: 40, top_process: "cc1plus" }] });
  const ended = nextHistory(started, hot, 1010);
  assert.deepEqual(ended.events.devbox.map((event) => [event.kind, event.text]), [
    ["start", "claude started in shop"],
    ["done", "agent 4100 ended"],
    ["alert", "devbox at CPU 95% · MEM 40%"],
  ]);
});

test("historyOrEmpty starts over when the stored history has an older shape", () => {
  assert.deepEqual(historyOrEmpty({ hosts: {} }), emptyHistory());
  const stored = { hosts: {}, agents: {}, events: {}, pids: {} };
  assert.equal(historyOrEmpty(stored), stored);
});

test("samplesInRange pads on the left so new samples grow from the right", () => {
  assert.deepEqual(samplesInRange([1, 2, 3], 5), [null, null, 1, 2, 3]);
  assert.deepEqual(samplesInRange([1, 2, 3, 4], 2), [3, 4]);
  assert.deepEqual(samplesInRange(undefined, 2), [null, null]);
});

test("eventMarkers places an event at its time on the chart window", () => {
  const history = emptyHistory();
  history.hosts.devbox = { at: [100, 105, 110], cpu: [], mem: [], rx: [], tx: [] };
  history.events.devbox = [{ at: 105, kind: "start", text: "claude started" }, { at: 50, kind: "done", text: "too old" }];
  const markers = eventMarkers(history, "devbox", 5);
  assert.deepEqual(markers, [{ position: 0.75, kind: "start", text: "claude started" }]);
});
