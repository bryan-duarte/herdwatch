import { strict as assert } from "node:assert";
import { test } from "node:test";
import { age, byteRate, homeRelative, percentText, storageSize } from "../mods/herdwatch/format.js";
import { clockKey, hostHealth, isPollLate, isStale, percentLevel } from "../mods/herdwatch/health.js";
import { SETTINGS, hostSnapshot, snapshot } from "./support/snapshots.js";

test("percentLevel compares with the warn and crit settings", () => {
  assert.equal(percentLevel(null, SETTINGS), "normal");
  assert.equal(percentLevel(69, SETTINGS), "normal");
  assert.equal(percentLevel(70, SETTINGS), "warning");
  assert.equal(percentLevel(90, SETTINGS), "critical");
});

test("hostHealth is the connection state, or the level of the busier resource", () => {
  assert.equal(hostHealth(hostSnapshot({ state: "auth" }), SETTINGS), "auth");
  assert.equal(hostHealth(hostSnapshot({ cpu_pct: 10, mem_pct: 95 }), SETTINGS), "critical");
  assert.equal(hostHealth(hostSnapshot({ cpu_pct: null, mem_pct: null }), SETTINGS), "normal");
});

test("isStale is true when the last update is older than stale_seconds", () => {
  assert.equal(isStale(hostSnapshot({ updated_at: 1000 }), SETTINGS, 1030), false);
  assert.equal(isStale(hostSnapshot({ updated_at: 1000 }), SETTINGS, 1031), true);
  assert.equal(isStale(hostSnapshot({ updated_at: null }), SETTINGS, 1000), true);
});

test("the text formats", () => {
  assert.deepEqual([age(42), age(600), age(7200), age(172800)], ["42s", "10m", "2h", "2d"]);
  assert.deepEqual([storageSize(512), storageSize(2097152), storageSize(null)], ["1 MiB", "2.0 GiB", "?"]);
  assert.deepEqual([byteRate(2048), byteRate(5242880), byteRate(null)], ["2 KB/s", "5.0 MB/s", "?"]);
  assert.equal(percentText(41.6), "42%");
  assert.equal(homeRelative("/home/dev/code", "/home/dev"), "~/code");
  assert.equal(homeRelative("/home/developer", "/home/dev"), "/home/developer");
});

test("isPollLate is true once the snapshot is older than stale_seconds", () => {
  assert.equal(isPollLate(snapshot({ generated_at: 1000 }), 1030), false);
  assert.equal(isPollLate(snapshot({ generated_at: 1000 }), 1031), true);
});

test("clockKey changes only when a late poll, a stale host or the minute changes", () => {
  const fresh = snapshot({ generated_at: 1000, hosts: [hostSnapshot({ updated_at: 1000 })] });
  assert.equal(clockKey(fresh, 1005), clockKey(fresh, 1019));
  assert.notEqual(clockKey(fresh, 1019), clockKey(fresh, 1020));
  assert.notEqual(clockKey(fresh, 1029), clockKey(fresh, 1031));
  assert.equal(clockKey(null, 1005), "none:16");
  assert.notEqual(clockKey(fresh, 1031), clockKey(fresh, 1033));
});
