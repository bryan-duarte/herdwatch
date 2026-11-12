import { strict as assert } from "node:assert";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MOD_ROOT = join(REPO_ROOT, "mods/herdwatch");
const BACKEND = join(MOD_ROOT, "bin/herdwatch");
const USAGE_EXIT_CODE = 2;
const WATCHDOG_EXIT_CODE = 124;

/**
 * A stand-in for ssh: it runs the remote command on this machine, so the fixed remote scripts run for real.
 * The target "deadhost" fails the way a name that does not resolve fails; "slowhost" never answers.
 */
const FAKE_SSH = `#!/bin/bash
while [ $# -gt 0 ]; do
  case "$1" in
    -o) shift 2 ;;
    -G) exit 0 ;;
    -O) exit 1 ;;
    -fN) exit 0 ;;
    --) shift; break ;;
    *) shift ;;
  esac
done
target="$1"; shift
case "$target" in
  deadhost) echo "ssh: Could not resolve hostname deadhost: nodename nor servname provided, or not known" >&2; exit 255 ;;
  slowhost) sleep 30 ;;
  checkhost) printf '%s\n' "# Tailscale SSH requires an additional check." "# To authenticate, visit: https://login.tailscale.com/a/x" >&2; sleep 30 ;;
esac
exec sh -c "$*"
`;

function scratchDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), "herdwatch-backend-")));
}

/** A config, a state folder and the fake ssh, so the backend runs without a network. */
function backendSandbox({ hosts = "local localhost\n", settings = "", pins = "" } = {}) {
  const root = scratchDir();
  const paths = { root, bin: join(root, "bin"), config: join(root, "config"), state: join(root, "state") };
  [paths.bin, paths.config, paths.state].forEach((folder) => mkdirSync(folder, { recursive: true }));
  writeFileSync(join(paths.bin, "ssh"), FAKE_SSH);
  chmodSync(join(paths.bin, "ssh"), 0o755);
  writeFileSync(join(paths.config, "hosts.conf"), hosts);
  writeFileSync(join(paths.config, "settings.conf"), settings);
  writeFileSync(join(paths.config, "pins.conf"), pins);
  const env = { ...process.env, PATH: `${paths.bin}:${process.env.PATH}`, HERDWATCH_CONFIG_DIR: paths.config, HERDWATCH_STATE_DIR: paths.state };
  const run = (...args) => spawnSync("bash", [BACKEND, ...args], { env, encoding: "utf8" });
  const action = (...args) => JSON.parse(run("action", ...args).stdout);
  return { paths, env, run, action };
}

/** @param {string} script */
function bashWithLibraries(script, env = process.env) {
  const libraries = ["state", "problems", "record", "ssh"].map((name) => `. "${MOD_ROOT}/lib/${name}.sh"`).join("; ");
  return execFileSync("bash", ["-c", `${libraries}; ${script}`], { env, encoding: "utf8" }).trim();
}

test("each kind of ssh error maps to its reason", () => {
  const cases = [
    ["@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@", "255", "auth hostkey"],
    ["Host key verification failed.", "255", "auth hostkey"],
    ["# Tailscale SSH requires an additional check.", "255", "auth tailscale_check"],
    ["dev@devbox: Permission denied (publickey).", "255", "auth login"],
    ["ssh: Could not resolve hostname devbox: Name or service not known", "255", "down dns"],
    ["ssh: connect to host devbox port 22: Connection refused", "255", "down refused"],
    ["ssh: connect to host devbox port 22: No route to host", "255", "down unreachable"],
    ["ssh: connect to host devbox port 22: Operation timed out", "255", "down timeout"],
    ["no such identity: /home/dev/.ssh/id_rsa: No such file or directory\nssh: connect to host devbox port 22: Connection timed out", "255", "down timeout"],
    ["/home/dev/.ssh/config: line 3: Bad configuration option: foo", "255", "down ssh_config"],
    ["sh: command not found", "127", "down remote_shell"],
    ["", "124", "down timeout"],
    ["# Tailscale SSH requires an additional check.", "124", "auth tailscale_check"],
    ["ssh: connect to host devbox port 22: Connection refused", "124", "down timeout"],
    ["", "1", "down unknown"],
  ];
  const folder = scratchDir();
  for (const [stderrText, exitCode, expectedReason] of cases) {
    const stderrFile = join(folder, "stderr");
    writeFileSync(stderrFile, `${stderrText}\n`);
    assert.equal(bashWithLibraries(`herdwatch_failure_reason "${stderrFile}" ${exitCode} /dev/null`), expectedReason, stderrText);
  }
  const outputFile = join(folder, "output");
  writeFileSync(outputFile, "Welcome to devbox!\n");
  writeFileSync(join(folder, "stderr"), "");
  assert.equal(bashWithLibraries(`herdwatch_failure_reason "${join(folder, "stderr")}" 0 "${outputFile}"`), "down probe_format");
});

test("the detail is the line that names the cause, not the last line", () => {
  const stderrFile = join(scratchDir(), "stderr");
  writeFileSync(stderrFile, "Warning: Permanently added 'devbox' to the list of known hosts.\ndev@devbox: Permission denied (publickey).\nConnection closed.\n");
  assert.equal(bashWithLibraries(`herdwatch_failure_detail "${stderrFile}"`), "dev@devbox: Permission denied (publickey).");
});

test("a host that does not answer in time fails with the watchdog code", () => {
  const sandbox = backendSandbox();
  const folder = sandbox.paths.root;
  const script = `RUNTIME_DIR="${folder}"; SSH_TIMEOUT=1; herdwatch_set_ssh_options; ` +
    `herdwatch_run_remote_script slowhost /dev/null true 1 "${folder}/out" "${folder}/err"; echo $?`;
  assert.equal(bashWithLibraries(script, sandbox.env), String(WATCHDOG_EXIT_CODE));
});

test("a Tailscale check that waits for the browser past the timeout shows as the check, not a timeout", () => {
  const sandbox = backendSandbox({ hosts: "kali checkhost\n", settings: "SSH_TIMEOUT=1\n" });
  const [kali] = JSON.parse(sandbox.run("snapshot").stdout).hosts;
  assert.equal(kali.state, "auth");
  assert.equal(kali.reason, "tailscale_check");
  assert.equal(kali.detail, "# Tailscale SSH requires an additional check.");
});

test("a snapshot names config problems, the reason a host is down, and a pinned port that stopped", () => {
  const sandbox = backendSandbox({
    hosts: "local localhost\ndead deadhost\nbad!label x\n",
    settings: "SSH_TIMEOUT=0\nFOO=1\n",
    pins: "local 1\nnope 22\nlocal 99999\n",
  });
  const first = JSON.parse(sandbox.run("snapshot").stdout);
  assert.equal(first.version, 3);
  assert.deepEqual(first.problems.map((problem) => `${problem.file}:${problem.line}:${problem.reason}`), [
    "settings.conf:1:not_a_positive_integer",
    "settings.conf:2:unknown_key",
    "hosts.conf:3:bad_label",
    "pins.conf:2:unknown_host",
    "pins.conf:3:bad_port",
  ]);
  const [local, dead] = first.hosts;
  assert.deepEqual(local.ports.find((port) => port.port === 1), { port: 1, pid: null, process: "", agent_pid: null, pinned: true, listening: false });
  assert.equal(dead.reason, "dns");
  assert.match(dead.detail, /Could not resolve hostname deadhost/);
  assert.deepEqual(first.alerts.map((alert) => `${alert.kind}:${alert.port}`), ["port_down:1"]);
  const second = JSON.parse(sandbox.run("snapshot").stdout);
  assert.deepEqual(second.alerts, [], "a port that stays down alerts once");
  assert.equal(second.hosts[1].down_since, dead.down_since, "down_since keeps the first failure");
});

test("an action without a known name prints the usage", () => {
  const sandbox = backendSandbox();
  const run = sandbox.run("action");
  assert.equal(run.status, USAGE_EXIT_CODE);
  assert.match(run.stderr, /herdwatch action/);
  assert.equal(sandbox.run("action", "reboot", "local").status, USAGE_EXIT_CODE);
});

test("an action checks its input before it reaches a host", () => {
  const sandbox = backendSandbox();
  const cases = [
    [["kill", "nohost", "5"], /No host named nohost/],
    [["kill", "local", "1"], /not a process that Herdwatch can stop/],
    [["kill", "local", "0"], /not a process that Herdwatch can stop/],
    [["kill", "local", "424242"], /not in the last poll of local/],
    [["pin", "local", "70000"], /not a number from 1 to 65535/],
    [["worktree-remove", "local", "/etc"], /not in the last measure of local/],
    [["docker-stop", "local", "Robert'); DROP"], /not a Docker id/],
    [["docker-rm", "local", "0123456789ab"], /not in the last Docker measure/],
  ];
  for (const [args, expectedMessage] of cases) {
    const result = sandbox.action(...args);
    assert.equal(result.ok, false, args.join(" "));
    assert.equal(result.reason, "bad_input", args.join(" "));
    assert.match(result.message, expectedMessage);
  }
});

test("pin and unpin rewrite pins.conf and keep its comments, also with Windows line ends", () => {
  const sandbox = backendSandbox({ pins: "# my pins\nlocal 8080\r\n" });
  assert.equal(sandbox.action("pin", "local", "3000").message, "Pinned :3000 on local.");
  assert.equal(sandbox.action("unpin", "local", "8080").message, "Unpinned :8080 on local.");
  assert.equal(readFileSync(join(sandbox.paths.config, "pins.conf"), "utf8"), "# my pins\nlocal 3000\n");
});

test("kill stops a process and its children, found at kill time", async () => {
  const sandbox = backendSandbox();
  const parent = spawn("sh", ["-c", "sleep 60 & sleep 60 & wait"], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const recordFile = join(sandbox.paths.state, "hosts/local.rec");
  mkdirSync(join(sandbox.paths.state, "hosts"), { recursive: true });
  writeFileSync(recordFile, `label=local\nstate=ok\n[procs]\n${parent.pid}\t0.0\t0.0\t0\tsh\n[agents]\n[ports]\n`);
  const result = sandbox.action("kill", "local", String(parent.pid));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.data.killed.length, 3);
  assert.deepEqual(result.data.alive, []);
});

test("force kill reaches a child that lived through TERM, also when TERM stopped the root", async () => {
  const sandbox = backendSandbox();
  const parent = spawn("sh", ["-c", "sh -c 'trap \"\" TERM; while :; do sleep 1; done' & wait"], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  mkdirSync(join(sandbox.paths.state, "hosts"), { recursive: true });
  writeFileSync(join(sandbox.paths.state, "hosts/local.rec"), `label=local\nstate=ok\n[procs]\n${parent.pid}\t0.0\t0.0\t0\tsh\n[agents]\n[ports]\n`);
  const first = sandbox.action("kill", "local", String(parent.pid));
  assert.equal(first.reason, "still_running", first.message);
  const forced = sandbox.action("kill", "local", String(parent.pid), "--force");
  assert.equal(forced.ok, true, forced.message);
  assert.ok(forced.data.killed.length >= 1);
  assert.deepEqual(forced.data.alive, []);
});

test("worktree-remove takes a path with a quote, refuses changes without force, and keeps an unmerged branch", () => {
  const sandbox = backendSandbox();
  const repository = join(sandbox.paths.root, "repos/app");
  const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
  mkdirSync(repository, { recursive: true });
  git("-C", repository, "init", "-q", "-b", "main");
  git("-C", repository, "commit", "-q", "--allow-empty", "-m", "start");
  const dirtyPath = join(repository, ".claude/worktrees/it's-dirty");
  const aheadPath = join(repository, ".claude/worktrees/ahead");
  git("-C", repository, "worktree", "add", "-q", dirtyPath, "-b", "feat/dirty");
  git("-C", repository, "worktree", "add", "-q", aheadPath, "-b", "feat/ahead");
  git("-C", aheadPath, "commit", "-q", "--allow-empty", "-m", "ahead");
  writeFileSync(join(dirtyPath, "new.txt"), "change\n");
  writeFileSync(join(sandbox.paths.config, "settings.conf"), `WORKTREE_ROOTS=${join(sandbox.paths.root, "repos")}\nWORKTREE_DEPTH=5\n`);
  sandbox.run("worktrees");

  assert.equal(sandbox.action("worktree-remove", "local", repository).reason, "bad_input");
  const refused = sandbox.action("worktree-remove", "local", dirtyPath);
  assert.equal(refused.reason, "dirty");
  assert.equal(refused.message, "1 file has uncommitted changes. Nothing was removed.");
  const removed = sandbox.action("worktree-remove", "local", dirtyPath, "--force", "--delete-branch");
  assert.equal(removed.message, "Removed the worktree and the branch feat/dirty.");
  const kept = sandbox.action("worktree-remove", "local", aheadPath, "--delete-branch");
  assert.equal(kept.reason, "branch_not_merged");
  assert.match(git("-C", repository, "branch"), /feat\/ahead/);
  assert.doesNotMatch(readFileSync(join(sandbox.paths.state, "hosts/local.worktrees"), "utf8"), /worktrees\/ahead/);
});

test("the worktree measure finds the branch a worktree is merged into and the roots that are missing", () => {
  const sandbox = backendSandbox();
  const repository = join(sandbox.paths.root, "repos/app");
  const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
  mkdirSync(repository, { recursive: true });
  git("-C", repository, "init", "-q", "-b", "main");
  git("-C", repository, "commit", "-q", "--allow-empty", "-m", "start");
  const donePath = join(repository, ".claude/worktrees/done");
  const newPath = join(repository, ".claude/worktrees/new");
  git("-C", repository, "worktree", "add", "-q", donePath, "-b", "feat/done");
  git("-C", donePath, "commit", "-q", "--allow-empty", "-m", "done");
  git("-C", repository, "merge", "-q", "--ff-only", "feat/done");
  git("-C", repository, "commit", "-q", "--allow-empty", "-m", "after");
  git("-C", repository, "worktree", "add", "-q", newPath, "-b", "feat/new");
  writeFileSync(join(sandbox.paths.config, "settings.conf"), `WORKTREE_ROOTS=${join(sandbox.paths.root, "repos")} ${join(sandbox.paths.root, "nope")}\n`);
  sandbox.run("worktrees");
  const snapshot = JSON.parse(sandbox.run("snapshot").stdout);
  const { worktrees } = snapshot.hosts[0];
  assert.equal(worktrees.reason, "missing_root");
  assert.match(worktrees.error, /nope/);
  const done = worktrees.items.find((item) => item.absolute_path === donePath);
  const fresh = worktrees.items.find((item) => item.absolute_path === newPath);
  assert.equal(done.merged_into, "main");
  assert.equal(fresh.merged_into, "", "a worktree without a commit of its own is new, not merged");
  assert.equal(done.common_dir, join(repository, ".git"));
  assert.ok(Number.isFinite(done.created_at));
});

test("the Docker probe turns docker output into rows with KiB sizes and epoch times", () => {
  const folder = scratchDir();
  const fakeDocker = `#!/bin/sh
case "$1 $2" in
  "info "*) exit 0 ;;
  "system df") if [ "$3" = -v ]; then printf 'Local Volumes space usage:\\n\\nVOLUME NAME   LINKS   SIZE\\npgdata        1       1.5GB\\nold           0       2MB\\n\\n'; else printf 'Images\\t3GB\\t1GB (33%%)\\nLocal Volumes\\t1.502GB\\t2MB (0%%)\\n'; fi ;;
  "ps -a") printf 'abcdef0123456789\\tweb-db\\tpostgres:16\\trunning\\t2026-11-10 12:00:00 +0000 UTC\\t12.5MB (virtual 400MB)\\n' ;;
  "images --no-trunc") printf 'sha256:0011223344556677\\tpostgres\\t16\\t400MB\\nsha256:8899aabbccddeeff\\t<none>\\t<none>\\t1GB\\n' ;;
esac
`;
  writeFileSync(join(folder, "docker"), fakeDocker);
  chmodSync(join(folder, "docker"), 0o755);
  const output = execFileSync("sh", [join(MOD_ROOT, "lib/docker_probe.sh")], { env: { ...process.env, PATH: `${folder}:${process.env.PATH}` }, encoding: "utf8" });
  assert.equal(output, [
    "docker=1",
    "total_kb=4396483",
    "reclaimable_kb=978515",
    "--containers--",
    "abcdef0123456789\tweb-db\tpostgres:16\trunning\t1794312000\t12207",
    "--images--",
    "0011223344556677\tpostgres\t16\t390625\t0",
    "8899aabbccddeeff\t<none>\t<none>\t976562\t1",
    "--volumes--",
    "pgdata\t1464843\t0",
    "old\t1953\t1",
    "",
  ].join("\n"));
});

test("a Docker file prints as JSON, and an off setting wins over the stored state", () => {
  const dockerFile = join(scratchDir(), "local.docker");
  writeFileSync(dockerFile, "state=ok\nmeasured_at=900\nreason=\nerror=\ntotal_kb=10\nreclaimable_kb=4\n[containers]\nabc\tweb\tnode:20\texited\t800\t12\n[images]\n[volumes]\nold\t4\t1\n");
  const printJson = (setting) => JSON.parse(execFileSync("awk", ["-v", "mode=docker", "-v", `docker_setting=${setting}`, "-f", join(MOD_ROOT, "lib/snapshot.awk"), dockerFile], { encoding: "utf8" }));
  const docker = printJson("on");
  assert.equal(docker.state, "ok");
  assert.deepEqual(docker.containers, [{ id: "abc", name: "web", image: "node:20", state: "exited", created_at: 800, size_kb: 12 }]);
  assert.deepEqual(docker.volumes, [{ name: "old", size_kb: 4, is_unused: true }]);
  assert.equal(printJson("off").state, "off");
});
