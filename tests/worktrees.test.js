import { strict as assert } from "node:assert";
import { test } from "node:test";
import { nowInSeconds } from "../mods/herdwatch/format.js";
import { WORKTREE_FILTERS, WORKTREE_FILTER_NAMES, deleteCheck, splitWorktrees, worktreeFacts, worktreeTotals, worktreesOrEmpty, worktreesSignature } from "../mods/herdwatch/worktrees.js";
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

test("the merged filter finds worktrees whose commits are all in a main branch", () => {
  assert.equal(WORKTREE_FILTERS.merged.matches(worktreeItem({ merged_into: "origin/main" }), []), true);
  assert.equal(WORKTREE_FILTERS.merged.matches(worktreeItem({ merged_into: "" }), []), false);
  assert.equal(WORKTREE_FILTERS.merged.matches(worktreeItem({ merged_into: undefined }), []), false);
  assert.equal(WORKTREE_FILTERS.merged.matches(worktreeItem({ merged_into: "main", changed_files: 2 }), []), false);
});

test("a worktree with an agent in it cannot be deleted, and the check says why", () => {
  const worktree = worktreeItem({ absolute_path: "/home/dev/code/shop" });
  assert.deepEqual(deleteCheck(worktree, [agentView("/home/dev/code/shop/src")]), { canDelete: false, reason: "An agent works here. Stop it first." });
  assert.equal(deleteCheck(worktree, [agentView("/home/dev/code/other")]).canDelete, true);
});

test("worktreeFacts gives each filter the count of its own matches, and the flags of each row", () => {
  const worktrees = [
    worktreeItem({ absolute_path: "/home/dev/code/old", last_commit_at: daysAgo(30), size_kb: 500 }),
    worktreeItem({ absolute_path: "/home/dev/code/busy", last_commit_at: daysAgo(30), size_kb: 900 }),
    worktreeItem({ absolute_path: "/home/dev/code/merged", merged_into: "main", behind: 2, last_commit_at: daysAgo(0) }),
    worktreeItem({ absolute_path: "/home/dev/code/dirty", changed_files: 4, last_commit_at: daysAgo(0), size_kb: 2000 }),
  ];
  const agents = [agentView("/home/dev/code/busy/src")];
  const facts = worktreeFacts(worktrees, agents);
  for (const name of WORKTREE_FILTER_NAMES) {
    assert.equal(facts.counts[name], worktrees.filter((worktree) => WORKTREE_FILTERS[name].matches(worktree, agents)).length, name);
  }
  assert.deepEqual(facts.flagsOfWorktree.get(worktrees[1]), { hasAgent: true, isStale: false, filters: new Set(["all", "agent"]) });
  assert.equal(facts.reclaimableKib, 500);
  assert.equal(facts.largestKib, 2000);
});
