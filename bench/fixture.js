import { HISTORY_SAMPLES, SECONDS_PER_SAMPLE, emptyHistory, nextHistory } from "../mods/herdwatch/history.js";
import { parseSnapshot } from "../mods/herdwatch/snapshot.js";
import { SETTINGS, agentProcess, hostDocker, hostSnapshot, listeningPort, snapshot, worktreeItem } from "../tests/support/snapshots.js";

/**
 * A synthetic host with the counts of a busy real one. Every name and path is made up: the repository is public,
 * so a live snapshot must never land here.
 */
export const FIXTURE_COUNTS = { processes: 54, agents: 7, ports: 31, cores: 8, worktrees: 64, containers: 16 };

const SECONDS_PER_DAY = 86400;
/** A bench run takes minutes; a short stale limit would add the late-poll notice halfway through and skew the counts. */
const BENCH_STALE_SECONDS = 3600;
const PROCESS_NAMES = ["node", "next-server (v15.1)", "python3.12", "postgres", "redis-server", "esbuild", "rust-analyzer", "Google Chrome Helper", "go", "java", "nginx", "docker-proxy", "tsserver", "vite"];
const AGENT_APPS = ["claude", "codex", "claude", "gemini", "claude", "codex", "opencode"];
const REPOSITORIES = ["shop", "api", "billing", "docs", "infra", "mobile", "search", "admin"];
const CONTAINER_STATES = ["running", "exited", "running", "paused", "created", "running", "exited", "dead"];
const WORKTREE_TOOLS = ["git", "claude", "codex", "conductor"];
const AGENT_WORKTREE_STRIDE = 9;
const FIRST_AGENT_PID = 5000;
const FIRST_PROCESS_PID = 6000;

/** A repeatable wave from 0 to 100, so the charts have shape. @param {number} step @param {number} phase */
const wave = (step, phase) => Math.round(50 + 45 * Math.sin((step + phase) / 7));

/** @param {number} index */
const worktreeFolder = (index) => `/home/dev/code/${REPOSITORIES[index % REPOSITORIES.length]}-wt-${index}`;

/** @param {number} now */
function worktrees(now) {
  return Array.from({ length: FIXTURE_COUNTS.worktrees }, (_unused, index) => worktreeItem({
    size_kb: 4096 * (index + 1) * ((index % 5) + 1),
    tool: WORKTREE_TOOLS[index % WORKTREE_TOOLS.length],
    repository: REPOSITORIES[index % REPOSITORIES.length],
    branch: `feature/task-${index}`,
    path: `~/code/${REPOSITORIES[index % REPOSITORIES.length]}-wt-${index}`,
    absolute_path: worktreeFolder(index),
    changed_files: index % 3 === 0 ? index % 11 : 0,
    ahead: index % 4,
    behind: index % 6 === 0 ? 3 : 0,
    last_commit_at: now - (index % 30) * SECONDS_PER_DAY,
    created_at: now - 40 * SECONDS_PER_DAY,
    last_activity_at: now - (index % 20) * SECONDS_PER_DAY,
    merged_into: index % 7 === 0 ? "main" : "",
  }));
}

/** @param {number} step */
function agents(step) {
  return AGENT_APPS.map((app, index) => agentProcess({
    pid: FIRST_AGENT_PID + index,
    app,
    cpu: wave(step, index * 3) / 2,
    tree_cpu: wave(step, index * 3),
    cwd: worktreeFolder(index * AGENT_WORKTREE_STRIDE),
    repository: REPOSITORIES[(index * AGENT_WORKTREE_STRIDE) % REPOSITORIES.length],
    branch: `feature/task-${index * AGENT_WORKTREE_STRIDE}`,
  }));
}

/** @param {number} step */
function processes(step) {
  return Array.from({ length: FIXTURE_COUNTS.processes }, (_unused, index) => ({
    pid: FIRST_PROCESS_PID + index,
    cpu: wave(step, index) / 4,
    mem: (index % 9) + 0.5,
    agent: index < FIXTURE_COUNTS.agents,
    name: PROCESS_NAMES[index % PROCESS_NAMES.length],
  }));
}

function ports() {
  return Array.from({ length: FIXTURE_COUNTS.ports }, (_unused, index) => listeningPort({
    port: 3000 + index,
    pid: FIRST_PROCESS_PID + index,
    process: PROCESS_NAMES[index % PROCESS_NAMES.length],
    agent_pid: index % 4 === 0 ? FIRST_AGENT_PID + (index % FIXTURE_COUNTS.agents) : null,
    pinned: index % 10 === 0,
  }));
}

/** @param {number} now */
function docker(now) {
  const containers = Array.from({ length: FIXTURE_COUNTS.containers }, (_unused, index) => ({
    id: `c${index.toString(16).padStart(11, "0")}`,
    name: `service-${index}`,
    image: `registry.local/${REPOSITORIES[index % REPOSITORIES.length]}:latest`,
    state: CONTAINER_STATES[index % CONTAINER_STATES.length],
    created_at: now - index * SECONDS_PER_DAY,
    size_kb: 2048 * (index + 1),
  }));
  const images = REPOSITORIES.map((repository, index) => ({ id: `i${index}`, repository, tag: "latest", size_kb: 512000 * (index + 1), is_dangling: index % 3 === 0 }));
  const volumes = REPOSITORIES.map((repository, index) => ({ name: `${repository}-data`, size_kb: 1024 * (index + 1), is_unused: index % 2 === 0 }));
  return hostDocker({ measured_at: now, total_kb: 9000000, reclaimable_kb: 2200000, containers, images, volumes });
}

/** The backend output for one poll at step of the history. @param {number} now @param {number} step */
function backendSnapshot(now, step) {
  const host = hostSnapshot({
    label: "benchhost",
    target: "dev@benchhost.lan",
    polled_at: now,
    updated_at: now,
    ncpu: FIXTURE_COUNTS.cores,
    cpu_pct: wave(step, 0),
    mem_pct: wave(step, 11),
    swap_pct: wave(step, 5) / 5,
    net_rx_rate: wave(step, 2) * 1000,
    net_tx_rate: wave(step, 9) * 400,
    cores: Array.from({ length: FIXTURE_COUNTS.cores }, (_unused, index) => wave(step, index * 2)),
    processes: processes(step),
    agents: agents(step),
    ports: ports(),
    worktrees: { state: "ok", measured_at: now, reason: "", error: "", total_kb: 41000000, items: worktrees(now) },
    docker: docker(now),
  });
  return snapshot({ generated_at: now, settings: { ...SETTINGS, stale_seconds: BENCH_STALE_SECONDS }, hosts: [host] });
}

/**
 * The newest backend output as text, and a full history that ends at it.
 * @param {number} now
 */
export function buildFixture(now) {
  let history = emptyHistory();
  for (let step = 0; step < HISTORY_SAMPLES; step++) {
    const sampleTime = now - (HISTORY_SAMPLES - 1 - step) * SECONDS_PER_SAMPLE;
    const parsed = parseSnapshot(JSON.stringify(backendSnapshot(sampleTime, step)));
    if (parsed.ok === false) throw new Error(`bench fixture does not parse: ${parsed.failure.detail}`);
    history = nextHistory(history, parsed.snapshot, sampleTime);
  }
  return { backendOutput: JSON.stringify(backendSnapshot(now, HISTORY_SAMPLES - 1)), history };
}
