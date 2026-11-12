import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MOD_ROOT = join(REPO_ROOT, "mods/herdwatch");
const PARSE_AWK = join(MOD_ROOT, "lib/parse.awk");
const SNAPSHOT_AWK = join(MOD_ROOT, "lib/snapshot.awk");
const BACKEND = join(MOD_ROOT, "bin/herdwatch");
const FIXTURES = join(REPO_ROOT, "tests/fixtures/backend");
const AGENT_PATTERN = "(^|/)(claude|codex|omp|node)$";
const FIRST_POLL_AT = "1000";
const SECOND_POLL_AT = "1010";
const USAGE_EXIT_CODE = 2;

const fixture = (name) => join(FIXTURES, name);
const expected = (name) => readFileSync(join(FIXTURES, "expected", name), "utf8");

function parseProbe({ label, target, now, previousRecord, probeOutput }) {
  return execFileSync("awk", ["-v", `label=${label}`, "-v", `target=${target}`, "-v", `now=${now}`, "-f", PARSE_AWK, previousRecord, probeOutput], {
    env: { ...process.env, HERDWATCH_AGENT_PATTERN: AGENT_PATTERN },
    encoding: "utf8",
  });
}

function snapshotJson(mode, input, variables = {}) {
  const variableArguments = Object.entries(variables).flatMap(([name, value]) => ["-v", `${name}=${value}`]);
  return execFileSync("awk", ["-v", `mode=${mode}`, ...variableArguments, "-f", SNAPSHOT_AWK, input], { encoding: "utf8" });
}

function writeScratch(name, content) {
  const path = join(mkdtempSync(join(tmpdir(), "herdwatch-test-")), name);
  writeFileSync(path, content);
  return path;
}

test("parse.awk turns a first Linux probe into a record without rates", () => {
  const record = parseProbe({ label: "devbox", target: "dev@devbox", now: FIRST_POLL_AT, previousRecord: "/dev/null", probeOutput: fixture("probe-linux.txt") });
  assert.equal(record, expected("record-linux.rec"));
});

test("parse.awk turns byte counters into rates against the previous record", () => {
  const previousRecord = writeScratch("devbox.rec", expected("record-linux.rec"));
  const record = parseProbe({ label: "devbox", target: "dev@devbox", now: SECOND_POLL_AT, previousRecord, probeOutput: fixture("probe-linux-next.txt") });
  assert.equal(record, expected("record-linux-next.rec"));
});

test("parse.awk reads a macOS probe", () => {
  const record = parseProbe({ label: "mac", target: "mac", now: FIRST_POLL_AT, previousRecord: "/dev/null", probeOutput: fixture("probe-darwin.txt") });
  assert.equal(record, expected("record-darwin.rec"));
});

test("snapshot.awk prints a host record as JSON", () => {
  const linuxRecord = writeScratch("devbox.rec", expected("record-linux-next.rec"));
  const darwinRecord = writeScratch("mac.rec", expected("record-darwin.rec"));
  assert.equal(snapshotJson("host", linuxRecord, { label: "devbox", target: "dev@devbox" }), expected("host-linux.json"));
  assert.equal(snapshotJson("host", darwinRecord, { label: "mac", target: "mac" }), expected("host-darwin.json"));
});

test("snapshot.awk prints a pending host when there is no record yet", () => {
  assert.equal(snapshotJson("host", "/dev/null", { label: "fresh", target: "fresh" }), expected("host-pending.json"));
});

test("snapshot.awk prints worktrees and alerts as JSON", () => {
  assert.equal(snapshotJson("worktrees", fixture("worktrees.txt")), expected("worktrees.json"));
  assert.equal(snapshotJson("alerts", fixture("alert-outbox.txt")), expected("alerts.json"));
});

test("every JSON output parses", () => {
  ["host-linux.json", "host-darwin.json", "host-pending.json", "worktrees.json", "alerts.json"].forEach((name) => {
    assert.doesNotThrow(() => JSON.parse(expected(name)), name);
  });
});

test("the backend rejects an unknown command with the usage exit code", () => {
  const run = spawnSync("bash", [BACKEND, "unknown"], { encoding: "utf8" });
  assert.equal(run.status, USAGE_EXIT_CODE);
  assert.match(run.stderr, /usage: herdwatch/);
});

test("the probe parts join into one valid POSIX sh script", () => {
  const probeParts = ["common", "agents", "linux", "darwin", "main"].map((part) => readFileSync(join(MOD_ROOT, `lib/probe/${part}.sh`), "utf8"));
  const syntaxCheck = spawnSync("sh", ["-n"], { input: probeParts.join(""), encoding: "utf8" });
  assert.equal(syntaxCheck.status, 0, syntaxCheck.stderr);
});
