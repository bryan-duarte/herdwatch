export const SETTINGS = {
  warn: 70,
  crit: 90,
  top_n: 30,
  ssh_timeout: 3,
  pane_refresh: 2,
  stale_seconds: 30,
  worktree_interval: 300,
  worktree_timeout: 120,
  docker_interval: 300,
  alerts: true,
  docker: true,
};

export function worktreeItem(overrides = {}) {
  return {
    size_kb: 1024,
    tool: "git",
    repository: "shop",
    branch: "main",
    path: "~/code/shop",
    changed_files: 0,
    ahead: 0,
    behind: 0,
    last_commit_at: 0,
    absolute_path: "/home/dev/code/shop",
    created_at: 800,
    last_activity_at: 900,
    merged_into: "",
    common_dir: "/home/dev/code/main/.git",
    default_branch: "main",
    ...overrides,
  };
}

export function agentProcess(overrides = {}) {
  return {
    pid: 4100,
    app: "claude",
    elapsed_seconds: 90,
    cpu: 12.5,
    mem: 1.2,
    cwd: "/home/dev/code/shop",
    branch: "main",
    repository: "shop",
    tree_cpu: 30,
    tree_rss_kb: 2097152,
    tree_count: 3,
    tree_names: "claude, node, esbuild",
    ...overrides,
  };
}

export function listeningPort(overrides = {}) {
  return { port: 3000, pid: 4200, process: "next-server", agent_pid: 4100, pinned: false, listening: true, ...overrides };
}

export function hostDocker(overrides = {}) {
  return { state: "ok", measured_at: 900, reason: "", error: "", total_kb: 2048, reclaimable_kb: 1024, containers: [], images: [], volumes: [], ...overrides };
}

export function hostSnapshot(overrides = {}) {
  return {
    label: "devbox",
    target: "dev@devbox.lan",
    state: "ok",
    reason: "",
    detail: "",
    os: "linux",
    load: "0.10 0.20 0.30",
    home: "/home/dev",
    polled_at: 1000,
    updated_at: 1000,
    down_since: null,
    rtt_ms: 42,
    ncpu: 8,
    uptime_seconds: 3600,
    cpu_pct: 40,
    mem_total_kb: 16777216,
    mem_used_kb: 8388608,
    mem_pct: 50,
    swap_total_kb: 0,
    swap_used_kb: 0,
    swap_pct: null,
    procs: 200,
    disk_pct: 60,
    disk_total_kb: 100000000,
    disk_used_kb: 60000000,
    disk_read_rate: 1024,
    disk_write_rate: 2048,
    disk_io_rate: null,
    net_rx_rate: 500,
    net_tx_rate: 250,
    cores: [30, 50],
    gpu: null,
    problems: [],
    processes: [],
    agents: [],
    ports: [],
    worktrees: { state: "ok", measured_at: 900, reason: "", error: "", total_kb: 1024, items: [worktreeItem()] },
    docker: hostDocker(),
    ...overrides,
  };
}

export function snapshot(overrides = {}) {
  return {
    version: 3,
    generated_at: 1000,
    hosts_file: "/home/dev/.config/herdwatch/hosts.conf",
    settings_file: "/home/dev/.config/herdwatch/settings.conf",
    pins_file: "/home/dev/.config/herdwatch/pins.conf",
    settings: SETTINGS,
    hosts: [hostSnapshot()],
    worktrees_due: false,
    docker_due: false,
    collector: { state: "ran", busy_since: null },
    problems: [],
    alerts: [],
    ...overrides,
  };
}
