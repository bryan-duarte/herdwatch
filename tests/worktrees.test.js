import { strict as assert } from "node:assert";
import { test } from "node:test";
import { nowInSeconds } from "../mods/herdwatch/format.js";
import { WORKTREE_FILTERS, splitWorktrees, worktreeTotals, worktreesOrEmpty, worktreesSignature } from "../mods/herdwatch/worktrees.js";
import { agentProcess, snapshot, worktreeItem } from "./support/snapshots.js";

const SECONDS_PER_DAY = 86400;
const daysAgo = (days) => nowInSeconds() - days * SECONDS_PER_DAY;
const agentView = (cwd) => ({ process: agentProcess({ cwd }), state: "working", cpuHistory: [] });

test("a worktree is stale after 14 days without a commit, unless an agent works in it", () => {
  const oldWorktree = worktreeItem({ last_commit_at: daysAgo(20), absolute_path: "/home/dev/code/old" });
  const freshWorktree = worktreeItem({ last_commit_at: daysAgo(2), absolute_path: "/home/dev/code/fresh" });
  assert.equal(WORKTREE_FILTERS.stale.matches(oldWorktree, []), true);
  assert.equal(WORKTREE_FILTERS.stale.matches(freshWorktree, []), false);
  assert.equal(WORKTREE_FILTERS.stale.matches(oldWorktree, [agentView("/home/dev/code/old/src")]), false);
  assert.equal(WORKTREE_FILTERS.agent.matches(oldWorktree, [agentView("/home/dev/code/older")]), false);
});

test("the changed and behind filters read the git counts", () => {
  assert.equal(WORKTREE_FILTERS.changed.matches(worktreeItem({ changed_files: 3 }), []), true);
  assert.equal(WORKTREE_FILTERS.changed.matches(worktreeItem({ changed_files: null }), []), false);
  assert.equal(WORKTREE_FILTERS.behind.matches(worktreeItem({ behind: 1 }), []), true);
});

test("worktreeTotals counts the stale worktrees and the space they hold", () => {
  const worktrees = [
    worktreeItem({ size_kb: 500, last_commit_at: daysAgo(30) }),
    worktreeItem({ size_kb: 2000, last_commit_at: daysAgo(1) }),
    worktreeItem({ size_kb: 300, last_commit_at: daysAgo(40) }),
  ];
  assert.deepEqual(worktreeTotals(worktrees, []), { staleCount: 2, reclaimableKib: 800, largestKib: 2000 });
});

test("splitWorktrees moves the lists out of the snapshot, and the signature changes only on a new measure", () => {
  const { lightSnapshot, worktreesByHost } = splitWorktrees(snapshot());
  assert.deepEqual(lightSnapshot.hosts[0].worktrees.items, []);
  assert.equal(lightSnapshot.hosts[0].worktrees.total_kb, 1024);
  assert.equal(worktreesByHost.devbox.items.length, 1);
  const remeasured = { devbox: { ...worktreesByHost.devbox, measured_at: 1200 } };
  assert.equal(worktreesSignature(worktreesByHost), worktreesSignature(splitWorktrees(snapshot()).worktreesByHost));
  assert.notEqual(worktreesSignature(worktreesByHost), worktreesSignature(remeasured));
});

test("worktreesOrEmpty keeps only valid host entries", () => {
  const valid = { state: "ok", measured_at: 1, error: "", total_kb: 0, items: [] };
  assert.deepEqual(worktreesOrEmpty({ devbox: valid, broken: { state: "ok" } }), { devbox: valid });
  assert.deepEqual(worktreesOrEmpty(null), {});
});
