import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import { fakeHerdr, resetFakeHerdr } from "herdr";
import { dockerPruneDialog, killDialog, worktreeDialog } from "../mods/herdwatch/action-dialogs.js";
import { runAction } from "../mods/herdwatch/actions.js";
import { clearPendingAction, readPendingAction, storePendingAction } from "../mods/herdwatch/pending-action.js";
import { runningTunnels, startTunnel, tunnelName } from "../mods/herdwatch/tunnels.js";
import { agentProcess, hostSnapshot, listeningPort, worktreeItem } from "./support/snapshots.js";

const PENDING_KEY = "herdwatch.pending";

beforeEach(resetFakeHerdr);

/** @param {object} printed */
function backendPrints(printed) {
  fakeHerdr.execHandler = async () => ({ code: 0, stdout: JSON.stringify(printed), stderr: "" });
}

test("runAction passes the arguments as a list and returns the backend result", async () => {
  backendPrints({ ok: false, reason: "not_owner", message: "You do not own this process. Herdwatch never uses sudo.", detail: "" });
  const result = await runAction("kill", "devbox", ["4100", "--force"]);
  assert.deepEqual(fakeHerdr.execCalls[0].args.slice(1), ["action", "kill", "devbox", "4100", "--force"]);
  assert.deepEqual(result, { ok: false, reason: "not_owner", message: "You do not own this process. Herdwatch never uses sudo.", detail: "" });
});

test("runAction turns unreadable output and a failed backend into failures", async () => {
  fakeHerdr.execHandler = async () => ({ code: 0, stdout: "not json", stderr: "" });
  assert.equal((await runAction("pin", "devbox", ["3000"])).reason, "remote_error");
  backendPrints({ ok: false, reason: "made_up", message: "?" });
  assert.equal((await runAction("pin", "devbox", ["3000"])).reason, "remote_error");
  fakeHerdr.execHandler = async () => ({ code: 2, stdout: "", stderr: "usage" });
  assert.deepEqual(await runAction("pin", "devbox", ["3000"]), { ok: false, reason: "remote_error", message: "The Herdwatch backend failed.", detail: "usage" });
});

test("a second dialog cannot start while one is open, and a stale dialog reads nothing", () => {
  const first = storePendingAction(killDialog(hostSnapshot(), 4100));
  assert.ok(first);
  assert.equal(storePendingAction(killDialog(hostSnapshot(), 4200)), null);
  assert.equal(readPendingAction("another-id"), null);
  assert.equal(readPendingAction(first.id).args[0], "4100");
  clearPendingAction("another-id");
  assert.ok(readPendingAction(first.id));
  clearPendingAction(first.id);
  assert.equal(readPendingAction(first.id), null);
});

test("an old pending action from a dialog that never closed does not block a new one", () => {
  fakeHerdr.sharedState.set(PENDING_KEY, { ...killDialog(hostSnapshot(), 4100), id: "old", createdAt: 1 });
  assert.ok(storePendingAction(killDialog(hostSnapshot(), 4200)));
});

test("the kill dialog names the agent, its tree and its ports, and offers force kill", () => {
  const host = hostSnapshot({ agents: [agentProcess()], ports: [listeningPort({ pid: 4100 })] });
  const dialog = killDialog(host, 4100);
  assert.deepEqual(dialog.details, [
    "claude (pid 4100) on devbox.",
    "This is the claude agent in ~/code/shop. 3 processes in its tree.",
    "It holds port :3000.",
    "Herdwatch sends TERM to the process and every process under it.",
  ]);
  assert.deepEqual(dialog.escalation, { reason: "still_running", confirmLabel: "Force kill", flag: "--force" });
});

test("the worktree dialog warns about changes, removes with force, and offers the branch", () => {
  const dirty = worktreeDialog(hostSnapshot(), worktreeItem({ changed_files: 12, branch: "feat/auth", merged_into: "main", size_kb: 4404019 }));
  assert.deepEqual(dirty.args, ["/home/dev/code/shop", "--force"]);
  assert.deepEqual(dirty.warnings, ["12 files have uncommitted changes. They will be lost."]);
  assert.deepEqual(dirty.details, ["~/code/shop", "branch feat/auth · merged into main", "Frees 4.2 GiB on devbox."]);
  assert.equal(dirty.options[0].flag, "--delete-branch");
  const detached = worktreeDialog(hostSnapshot(), worktreeItem({ branch: "detached 5bca5b1" }));
  assert.deepEqual(detached.args, ["/home/dev/code/shop"]);
  assert.deepEqual(detached.options, []);
});

test("the prune dialog leaves volumes out unless the user ticks them", () => {
  const dialog = dockerPruneDialog(hostSnapshot(), { images_kb: 3250586, volumes_kb: 1048576 });
  assert.deepEqual(dialog.args, []);
  assert.equal(dialog.details[0], "Frees 3.1 GiB of unused images on devbox.");
  assert.deepEqual(dialog.options, [{ key: "volumes", label: "Also delete unused volumes (1.0 GiB). Their data is lost for good.", checked: false, flag: "--volumes" }]);
});

test("a tunnel name fits herdr-core's rules", () => {
  assert.equal(tunnelName("Kali.Box", 3000), "hw-tunnel-kali-box-3000");
  assert.equal(tunnelName("staging-backend-eu", 8080), "hw-tunnel-staging-backend-e-8080");
  assert.notEqual(tunnelName("staging-backend-eu", 8080), tunnelName("staging-backend-eu", 8081));
  assert.ok(tunnelName("a-very-long-host-label-x", 65535).length <= 32);
});

test("running tunnels come from the labels of live terminals", () => {
  fakeHerdr.terminals = [
    { address: "t7", state: "live", labels: { herdwatch: "tunnel", "herdwatch.host": "devbox", "herdwatch.remote_port": "3000", "herdwatch.local_port": "3001" } },
    { address: "t8", state: "finished", labels: { herdwatch: "tunnel", "herdwatch.host": "devbox", "herdwatch.remote_port": "8080", "herdwatch.local_port": "8080" } },
    { address: "t9", state: "live", labels: {} },
  ];
  assert.deepEqual(runningTunnels(), [{ terminal: "t7", label: "devbox", remotePort: 3000, localPort: 3001, state: "running" }]);
});

test("a tunnel binds to 127.0.0.1 and takes the first free local port", async () => {
  fakeHerdr.execHandler = async (_command, args) => {
    const isBusyCheck = args[1].startsWith("(exec");
    const port = Number(args.at(-1));
    return { code: isBusyCheck && port === 3000 ? 0 : isBusyCheck ? 1 : 0, stdout: "", stderr: "" };
  };
  const started = await startTunnel({ label: "devbox", target: "dev@devbox.lan" }, 3000);
  assert.deepEqual(started, { ok: true, localPort: 3001 });
  const command = fakeHerdr.hcCalls[0];
  assert.ok(command.includes("127.0.0.1:3001:localhost:3000"));
  assert.ok(!command.includes("-g"));
  assert.deepEqual(command.slice(-2), ["--", "dev@devbox.lan"]);
});

test("a tunnel that does not open reports the ssh line and removes its terminal", async () => {
  fakeHerdr.execHandler = async () => ({ code: 1, stdout: "", stderr: "" });
  fakeHerdr.hcHandler = async (args) => ({ code: 0, stdout: args[0] === "read" ? "\nbind [127.0.0.1]:3000: Address already in use\n" : "", stderr: "" });
  const started = await startTunnel({ label: "devbox", target: "dev@devbox.lan" }, 3000);
  assert.equal(started.ok, false);
  assert.match(started.message, /Address already in use/);
  assert.deepEqual(fakeHerdr.hcCalls.slice(-2).map((args) => args[0]), ["kill", "rm"]);
});
