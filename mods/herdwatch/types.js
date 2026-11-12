/**
 * @typedef {"ok" | "down" | "auth" | "pending"} HostState
 * @typedef {"normal" | "warning" | "critical"} PercentLevel
 * @typedef {"working" | "blocked" | "idle" | "done"} AgentState
 * @typedef {"overview" | "agents" | "ports" | "worktrees" | "procs"} ConsoleTab
 * @typedef {"all" | "stale" | "changed" | "agent" | "behind"} WorktreeFilter
 * @typedef {Record<string, import("gpui-kit").Color>} ThemeColors
 * @typedef {import("gpui-kit").Context} ModContext
 * @typedef {"cpu" | "mem"} ProcessSort
 * @typedef {import("gpui-kit").Element} Element
 *
 * @typedef {object} ProcessRow
 * @property {number | null} pid
 * @property {number | null} cpu
 * @property {number | null} mem
 * @property {boolean} agent
 * @property {string} name
 *
 * @typedef {object} AgentProcess
 * @property {number | null} pid
 * @property {string} app
 * @property {number | null} elapsed_seconds
 * @property {number | null} cpu
 * @property {number | null} mem
 * @property {string} cwd
 * @property {string} branch
 * @property {string} repository
 *
 * @typedef {object} ListeningPort
 * @property {number} port
 * @property {number | null} pid
 * @property {string} process
 * @property {number | null} agent_pid
 *
 * @typedef {object} GpuInfo
 * @property {string} name
 * @property {number | null} pct
 * @property {number | null} mem_used_mib
 * @property {number | null} mem_total_mib
 *
 * @typedef {object} WorktreeItem
 * @property {number | null} size_kb
 * @property {string} tool
 * @property {string} repository
 * @property {string} branch
 * @property {string} path
 * @property {number | null} changed_files
 * @property {number | null} ahead
 * @property {number | null} behind
 * @property {number | null} last_commit_at
 * @property {string} absolute_path
 *
 * @typedef {object} HostWorktrees
 * @property {"ok" | "failed" | "pending"} state
 * @property {number | null} measured_at
 * @property {string} error
 * @property {number} total_kb
 * @property {WorktreeItem[]} items
 *
 * @typedef {object} HostSnapshot
 * @property {string} label
 * @property {string} target
 * @property {HostState} state
 * @property {string} error
 * @property {string} os
 * @property {string} load
 * @property {string} home
 * @property {number | null} polled_at
 * @property {number | null} updated_at
 * @property {number | null} ncpu
 * @property {number | null} uptime_seconds
 * @property {number | null} cpu_pct
 * @property {number | null} mem_total_kb
 * @property {number | null} mem_used_kb
 * @property {number | null} mem_pct
 * @property {number | null} swap_total_kb
 * @property {number | null} swap_used_kb
 * @property {number | null} swap_pct
 * @property {number | null} procs
 * @property {number | null} disk_pct
 * @property {number | null} disk_total_kb
 * @property {number | null} disk_used_kb
 * @property {number | null} disk_read_rate
 * @property {number | null} disk_write_rate
 * @property {number | null} disk_io_rate
 * @property {number | null} net_rx_rate
 * @property {number | null} net_tx_rate
 * @property {(number | null)[]} cores
 * @property {GpuInfo | null} gpu
 * @property {ProcessRow[]} processes
 * @property {AgentProcess[]} agents
 * @property {ListeningPort[]} ports
 * @property {HostWorktrees} worktrees
 *
 * @typedef {object} MonitorSettings
 * @property {number} warn
 * @property {number} crit
 * @property {number} top_n
 * @property {number} ssh_timeout
 * @property {number} pane_refresh
 * @property {number} stale_seconds
 * @property {number} worktree_interval
 * @property {number} worktree_timeout
 * @property {boolean} alerts
 *
 * @typedef {object} HotHostAlert
 * @property {string} label
 * @property {number | null} cpu_pct
 * @property {number | null} mem_pct
 * @property {string} top_process
 *
 * @typedef {object} Snapshot
 * @property {number} version
 * @property {number} generated_at
 * @property {string} hosts_file
 * @property {string} settings_file
 * @property {MonitorSettings} settings
 * @property {HostSnapshot[]} hosts
 * @property {boolean} worktrees_due
 * @property {HotHostAlert[]} alerts
 *
 * @typedef {object} MonitorState
 * @property {Snapshot | null} snapshot
 * @property {string | null} error
 *
 * @typedef {{ ok: true, snapshot: Snapshot } | { ok: false, error: string }} SnapshotResult
 *
 * @typedef {object} HostSeries
 * @property {number[]} at
 * @property {(number | null)[]} cpu
 * @property {(number | null)[]} mem
 * @property {(number | null)[]} swap
 * @property {(number | null)[]} rx
 * @property {(number | null)[]} tx
 *
 * @typedef {object} HostEvent
 * @property {number} at
 * @property {"start" | "done" | "alert"} kind
 * @property {string} text
 *
 * @typedef {object} MonitorHistory
 * @property {Record<string, HostSeries>} hosts
 * @property {Record<string, (number | null)[]>} agents
 * @property {Record<string, HostEvent[]>} events
 * @property {Record<string, number[]>} pids
 *
 * @typedef {Record<string, HostWorktrees>} WorktreesByHost
 *
 * @typedef {object} AgentView
 * @property {AgentProcess} process
 * @property {AgentState} state
 * @property {(number | null)[]} cpuHistory
 *
 * @typedef {object} ConsoleView
 * @property {MonitorState | null} monitorState
 * @property {MonitorHistory} history
 * @property {WorktreesByHost} worktrees
 * @property {HostSnapshot | null} host
 * @property {AgentView[]} agents
 * @property {ConsoleTab} tab
 * @property {number} rangeSamples
 * @property {ProcessSort} sort
 * @property {WorktreeFilter} worktreeFilter
 * @property {string | null} shortcut
 * @property {boolean} hasKeyboard
 * @property {number} width
 * @property {(label: string) => void} onHost
 * @property {(tab: ConsoleTab) => void} onTab
 * @property {(samples: number) => void} onRange
 * @property {(sort: ProcessSort) => void} onSort
 * @property {(filter: WorktreeFilter) => void} onWorktreeFilter
 * @property {() => void} onClose
 */
export {};
