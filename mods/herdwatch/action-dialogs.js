import { homeRelative, storageSize } from "./format.js";

/** @typedef {import("./schemas.js").AgentView} AgentView */
/** @typedef {import("./schemas.js").DockerContainer} DockerContainer */
/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").PendingAction} PendingAction */
/** @typedef {import("./schemas.js").WorktreeItem} WorktreeItem */
/** @typedef {Omit<PendingAction, "id" | "createdAt">} DialogCopy */

const UNNAMED_BRANCH = /^(detached |\?$)/;

/** @param {number} count @param {string} singular @param {string} plural */
const countText = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;

/** @param {HostSnapshot} host @param {number} pid */
function processName(host, pid) {
  const topProcess = host.processes.find((process) => process.pid === pid);
  const agent = host.agents.find((agentProcess) => agentProcess.pid === pid);
  const portOwner = host.ports.find((port) => port.pid === pid);
  return topProcess?.name || agent?.app || portOwner?.process || "process";
}

/**
 * @param {HostSnapshot} host
 * @param {number} pid
 * @returns {DialogCopy}
 */
export function killDialog(host, pid) {
  const agent = host.agents.find((agentProcess) => agentProcess.pid === pid);
  const heldPorts = host.ports.filter((port) => port.pid === pid && port.listening).map((port) => `:${port.port}`);
  const details = [`${processName(host, pid)} (pid ${pid}) on ${host.label}.`];
  if (agent) {
    const treeSize = Number.isFinite(agent.tree_count) ? ` ${countText(agent.tree_count, "process", "processes")} in its tree.` : "";
    details.push(`This is the ${agent.app} agent in ${homeRelative(agent.cwd, host.home)}.${treeSize}`);
  }
  if (heldPorts.length) details.push(`It holds ${heldPorts.length === 1 ? "port" : "ports"} ${heldPorts.join(", ")}.`);
  details.push("Herdwatch sends TERM to the process and every process under it.");
  return {
    name: "kill",
    label: host.label,
    args: [String(pid)],
    title: "Kill process",
    details,
    warnings: [],
    options: [],
    confirmLabel: "Kill",
    isDestructive: true,
    escalation: { reason: "still_running", confirmLabel: "Force kill", flag: "--force" },
  };
}

/**
 * Uncommitted changes are the user's choice to lose: the dialog shows them, and Confirm then removes with --force.
 * @param {HostSnapshot} host
 * @param {WorktreeItem} worktree
 * @returns {DialogCopy}
 */
export function worktreeDialog(host, worktree) {
  const changedFiles = worktree.changed_files ?? 0;
  const hasChanges = changedFiles > 0;
  const hasNamedBranch = !UNNAMED_BRANCH.test(worktree.branch);
  const mergedText = worktree.merged_into ? `merged into ${worktree.merged_into}` : "not merged";
  return {
    name: "worktree-remove",
    label: host.label,
    args: [worktree.absolute_path, ...(hasChanges ? ["--force"] : [])],
    title: "Remove worktree",
    details: [worktree.path, `branch ${worktree.branch} · ${mergedText}`, `Frees ${storageSize(worktree.size_kb)} on ${host.label}.`],
    warnings: hasChanges ? [`${countText(changedFiles, "file has", "files have")} uncommitted changes. They will be lost.`] : [],
    options: hasNamedBranch
      ? [{ key: "deleteBranch", label: `Also delete the branch ${worktree.branch}`, checked: false, flag: "--delete-branch" }]
      : [],
    confirmLabel: "Remove",
    isDestructive: true,
    escalation: null,
  };
}

/**
 * @param {HostSnapshot} host
 * @param {DockerContainer} container
 * @param {"docker-stop" | "docker-rm"} name
 * @returns {DialogCopy}
 */
export function dockerContainerDialog(host, container, name) {
  const isStop = name === "docker-stop";
  return {
    name,
    label: host.label,
    args: [container.id],
    title: isStop ? "Stop container" : "Remove container",
    details: [`${container.name} (${container.image}) on ${host.label}.`],
    warnings: isStop ? [] : ["Docker deletes the files that the container wrote. The image stays."],
    options: [],
    confirmLabel: isStop ? "Stop" : "Remove",
    isDestructive: !isStop,
    escalation: null,
  };
}

/**
 * Volumes are left out unless the user ticks them, because a volume can hold database data.
 * @param {HostSnapshot} host
 * @param {{ images_kb: number, volumes_kb: number }} preview
 * @returns {DialogCopy}
 */
export function dockerPruneDialog(host, preview) {
  return {
    name: "docker-prune",
    label: host.label,
    args: [],
    title: "Prune Docker data",
    details: [`Frees ${storageSize(preview.images_kb)} of unused images on ${host.label}.`],
    warnings: ["Docker downloads a deleted image again when a container needs it."],
    options: [{
      key: "volumes",
      label: `Also delete unused volumes (${storageSize(preview.volumes_kb)}). Their data is lost for good.`,
      checked: false,
      flag: "--volumes",
    }],
    confirmLabel: "Prune",
    isDestructive: true,
    escalation: null,
  };
}
