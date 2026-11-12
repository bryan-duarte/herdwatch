import { daysSince } from "./format.js";
import { isHostWorktrees, isRecord } from "./snapshot.js";

/** @typedef {import("./schemas.js").AgentView} AgentView */
/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").HostWorktrees} HostWorktrees */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */
/** @typedef {import("./schemas.js").WorktreeFacts} WorktreeFacts */
/** @typedef {import("./schemas.js").WorktreeFilter} WorktreeFilter */
/** @typedef {import("./schemas.js").WorktreeFlags} WorktreeFlags */
/** @typedef {import("./schemas.js").WorktreeItem} WorktreeItem */
/** @typedef {import("./schemas.js").WorktreesByHost} WorktreesByHost */

export const STALE_WORKTREE_DAYS = 14;

/** @param {WorktreeItem} worktree @param {AgentView} agent */
function isAgentInside(worktree, { process }) {
  const folder = worktree.absolute_path;
  return process.cwd === folder || process.cwd.startsWith(`${folder}/`);
}

/** @param {WorktreeItem} worktree @param {AgentView[]} agents */
export const hasAgentIn = (worktree, agents) => agents.some((agent) => isAgentInside(worktree, agent));

/** @param {WorktreeItem} worktree @param {AgentView[]} agents */
export function isStaleWorktree(worktree, agents) {
  const hasOldLastCommit = (daysSince(worktree.last_commit_at) ?? 0) > STALE_WORKTREE_DAYS;
  return hasOldLastCommit && !hasAgentIn(worktree, agents);
}

/** @param {WorktreeItem} worktree */
const hasUncommittedChanges = (worktree) => (worktree.changed_files ?? 0) > 0;

/** @param {WorktreeItem} worktree */
const isBehindUpstream = (worktree) => (worktree.behind ?? 0) > 0;

/**
 * Every commit is in a main branch and nothing is waiting to be committed, so removing it loses no work.
 * @param {WorktreeItem} worktree
 */
export const isMergedWorktree = (worktree) => Boolean(worktree.merged_into) && !hasUncommittedChanges(worktree);

/**
 * @param {WorktreeItem} worktree
 * @param {AgentView[]} agents
 * @returns {{ canDelete: boolean, reason: string }}
 */
export const deleteCheck = (worktree, agents) => deleteCheckFor(hasAgentIn(worktree, agents));

/** @param {boolean} hasAgent @returns {{ canDelete: boolean, reason: string }} */
export function deleteCheckFor(hasAgent) {
  if (hasAgent) return { canDelete: false, reason: "An agent works here. Stop it first." };
  return { canDelete: true, reason: "Remove this worktree" };
}

/** @type {Record<WorktreeFilter, { label: string, tooltip: string, matches: (worktree: WorktreeItem, agents: AgentView[]) => boolean }>} */
export const WORKTREE_FILTERS = {
  all: { label: "all", tooltip: "Show every worktree", matches: () => true },
  stale: { label: `stale > ${STALE_WORKTREE_DAYS}d`, tooltip: `No commit for ${STALE_WORKTREE_DAYS} days and no agent in it`, matches: isStaleWorktree },
  merged: { label: "merged", tooltip: "Every commit is in a main branch, so the worktree is safe to remove", matches: isMergedWorktree },
  changed: { label: "uncommitted", tooltip: "Worktrees with uncommitted changes", matches: hasUncommittedChanges },
  agent: { label: "agent running", tooltip: "Worktrees where an agent works now", matches: hasAgentIn },
  behind: { label: "behind upstream", tooltip: "Worktrees behind their upstream branch", matches: isBehindUpstream },
};

export const WORKTREE_FILTER_NAMES = /** @type {WorktreeFilter[]} */ (Object.keys(WORKTREE_FILTERS));

/**
 * The flags of every row and the count of every filter in one pass, so a render checks each worktree against the
 * agents once: each filter then sees only the agents inside that worktree.
 * @param {WorktreeItem[]} worktrees
 * @param {AgentView[]} agents
 * @returns {WorktreeFacts}
 */
export function worktreeFacts(worktrees, agents) {
  /** @type {Map<WorktreeItem, WorktreeFlags>} */
  const flagsOfWorktree = new Map();
  const counts = /** @type {Record<WorktreeFilter, number>} */ (Object.fromEntries(WORKTREE_FILTER_NAMES.map((name) => [name, 0])));
  let reclaimableKib = 0;
  let largestKib = 0;
  for (const worktree of worktrees) {
    const agentsInside = agents.filter((agent) => isAgentInside(worktree, agent));
    const filters = new Set(WORKTREE_FILTER_NAMES.filter((name) => WORKTREE_FILTERS[name].matches(worktree, agentsInside)));
    filters.forEach((name) => { counts[name] += 1; });
    const isStale = filters.has("stale");
    flagsOfWorktree.set(worktree, { hasAgent: agentsInside.length > 0, isStale, filters });
    largestKib = Math.max(largestKib, worktree.size_kb ?? 0);
    if (isStale) reclaimableKib += worktree.size_kb ?? 0;
  }
  return { flagsOfWorktree, counts, reclaimableKib, largestKib };
}

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
