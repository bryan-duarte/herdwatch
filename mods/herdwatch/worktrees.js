import { daysSince } from "./format.js";
import { isHostWorktrees, isRecord } from "./snapshot.js";

/** @typedef {import("./schemas.js").AgentView} AgentView */
/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").HostWorktrees} HostWorktrees */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */
/** @typedef {import("./schemas.js").WorktreeFilter} WorktreeFilter */
/** @typedef {import("./schemas.js").WorktreeItem} WorktreeItem */
/** @typedef {import("./schemas.js").WorktreesByHost} WorktreesByHost */

export const STALE_WORKTREE_DAYS = 14;

/** @param {WorktreeItem} worktree @param {AgentView[]} agents */
export function hasAgentIn(worktree, agents) {
  const folder = worktree.absolute_path;
  return agents.some(({ process }) => process.cwd === folder || process.cwd.startsWith(`${folder}/`));
}

/** @param {WorktreeItem} worktree @param {AgentView[]} agents */
export function isStaleWorktree(worktree, agents) {
  const hasOldLastCommit = (daysSince(worktree.last_commit_at) ?? 0) > STALE_WORKTREE_DAYS;
  return hasOldLastCommit && !hasAgentIn(worktree, agents);
}

/** @param {WorktreeItem} worktree */
const hasUncommittedChanges = (worktree) => (worktree.changed_files ?? 0) > 0;

/** @param {WorktreeItem} worktree */
const isBehindUpstream = (worktree) => (worktree.behind ?? 0) > 0;

/** @type {Record<WorktreeFilter, { label: string, tooltip: string, matches: (worktree: WorktreeItem, agents: AgentView[]) => boolean }>} */
export const WORKTREE_FILTERS = {
  all: { label: "all", tooltip: "Show every worktree", matches: () => true },
  stale: { label: `stale > ${STALE_WORKTREE_DAYS}d`, tooltip: `No commit for ${STALE_WORKTREE_DAYS} days and no agent in it`, matches: isStaleWorktree },
  changed: { label: "uncommitted", tooltip: "Worktrees with uncommitted changes", matches: hasUncommittedChanges },
  agent: { label: "agent running", tooltip: "Worktrees where an agent works now", matches: hasAgentIn },
  behind: { label: "behind upstream", tooltip: "Worktrees behind their upstream branch", matches: isBehindUpstream },
};

export const WORKTREE_FILTER_NAMES = /** @type {WorktreeFilter[]} */ (Object.keys(WORKTREE_FILTERS));

/** @param {WorktreeItem[]} worktrees */
const totalKib = (worktrees) => worktrees.reduce((sum, worktree) => sum + (worktree.size_kb ?? 0), 0);

/**
 * @param {WorktreeItem[]} worktrees
 * @param {AgentView[]} agents
 */
export function worktreeTotals(worktrees, agents) {
  const staleWorktrees = worktrees.filter((worktree) => isStaleWorktree(worktree, agents));
  return {
    staleCount: staleWorktrees.length,
    reclaimableKib: totalKib(staleWorktrees),
    largestKib: worktrees.reduce((largest, worktree) => Math.max(largest, worktree.size_kb ?? 0), 0),
  };
}

/**
 * The full lists live in their own shared key; the snapshot copy only has the totals.
 * @param {WorktreesByHost} worktreesByHost
 * @param {HostSnapshot} host
 * @returns {HostWorktrees}
 */
export const worktreesOfHost = (worktreesByHost, host) => worktreesByHost[host.label] ?? host.worktrees;

/**
 * Takes the worktree lists out of the snapshot, so the state that changes every poll stays small.
 * @param {Snapshot} snapshot
 * @returns {{ lightSnapshot: Snapshot, worktreesByHost: WorktreesByHost }}
 */
export function splitWorktrees(snapshot) {
  const worktreesByHost = Object.fromEntries(snapshot.hosts.map((host) => [host.label, host.worktrees]));
  const hosts = snapshot.hosts.map((host) => ({ ...host, worktrees: { ...host.worktrees, items: /** @type {WorktreeItem[]} */ ([]) } }));
  return { lightSnapshot: { ...snapshot, hosts }, worktreesByHost };
}

/**
 * Changes when any host gets a new measure, so the large worktree lists are written only then.
 * @param {WorktreesByHost} worktreesByHost
 */
export function worktreesSignature(worktreesByHost) {
  return Object.entries(worktreesByHost)
    .map(([label, worktrees]) => `${label}:${worktrees.state}:${worktrees.measured_at}:${worktrees.items.length}`)
    .sort()
    .join("|");
}

/**
 * @param {unknown} stored
 * @returns {WorktreesByHost}
 */
export function worktreesOrEmpty(stored) {
  if (!isRecord(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter(([, worktrees]) => isHostWorktrees(worktrees)));
}
