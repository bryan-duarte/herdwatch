import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import { fakeHerdr, resetFakeHerdr } from "herdr";
import { agentViews, herdrAgents } from "../mods/herdwatch/agents.js";
import { emptyHistory } from "../mods/herdwatch/history.js";
import { agentProcess, hostSnapshot } from "./support/snapshots.js";

beforeEach(resetFakeHerdr);

test("herdrAgents uses the program table key, and the app name for generic keys", () => {
  fakeHerdr.spaces = [{ id: "space-1", machine: "devbox" }];
  fakeHerdr.panes = [{ pane: "pane-1", cwd: "/home/dev/code/shop" }];
  fakeHerdr.agents = [
    { space: "space-1", pane: "pane-1", status: "blocked", app: "cursor-agent", program: { key: "cursor" } },
    { space: "space-1", pane: "pane-1", status: "idle", app: "Kimi-Code", program: { key: "agent" } },
    { space: "space-1", pane: "pane-1", status: "unknown", app: "claude" },
  ];
  assert.deepEqual(herdrAgents(), [
    { machine: "devbox", app: "cursor", cwd: "/home/dev/code/shop", state: "blocked" },
    { machine: "devbox", app: "kimi", cwd: "/home/dev/code/shop", state: "idle" },
  ]);
});

test("agentViews takes Herdr's state for a matching agent and the CPU state for the others", () => {
  const host = hostSnapshot({
    target: "ssh://dev@devbox.lan:2222",
    agents: [agentProcess({ pid: 1, app: "claude", cpu: 0 }), agentProcess({ pid: 2, app: "codex", cpu: 9, cwd: "/srv/api" })],
  });
  const history = emptyHistory();
  history.agents["devbox:2"] = [5, 9];
  const reported = [{ machine: "devbox.lan", app: "claude", cwd: "/home/dev/code/shop", state: "blocked" }];
  const views = agentViews(host, history, reported);
  assert.deepEqual(views.map((view) => view.state), ["blocked", "working"]);
  assert.deepEqual(views[1].cpuHistory, [5, 9]);
});

test("agentViews does not match an agent of another machine", () => {
  const host = hostSnapshot({ agents: [agentProcess({ cpu: 0 })] });
  const reported = [{ machine: "laptop", app: "claude", cwd: "/home/dev/code/shop", state: "blocked" }];
  assert.equal(agentViews(host, emptyHistory(), reported)[0].state, "idle");
});
