/**
 * @typedef {import("gpui-kit").Context} ModContext
 * @typedef {import("gpui-kit").AsyncContext} ModAsyncContext
 * @typedef {import("gpui-kit").Element} Element
 * @typedef {import("gpui-kit").Color} Color
 * @typedef {Record<string, Color>} ThemeColors
 *
 * @typedef {"ok" | "down" | "auth" | "pending"} HostState
 * @typedef {"normal" | "warning" | "critical"} PercentLevel
 * @typedef {Exclude<HostState, "ok"> | PercentLevel} HostHealth
 * @typedef {"working" | "blocked" | "idle" | "done"} AgentState
 * @typedef {"overview" | "agents" | "ports" | "worktrees" | "procs" | "docker"} ConsoleTab
 * @typedef {"all" | "stale" | "merged" | "changed" | "agent" | "behind"} WorktreeFilter
 * @typedef {"cpu" | "mem"} ProcessSort
 * @typedef {"dialog" | "console" | "bar"} CopyRole
 *
 * @typedef {"timeout" | "hostkey" | "tailscale_check" | "login" | "dns" | "refused" | "unreachable"
 *   | "ssh_config" | "remote_shell" | "probe_format" | "parse_failed" | "unknown"} FailureReason
 *
 * @typedef {"missing_tools" | "unsupported_os" | "ports_hidden"} HostProblemReason
 *
 * @typedef {object} HostProblem
 * @property {HostProblemReason} reason
 * @property {string} detail  the missing tools, e.g. "ss" or "git"
 *
 * @typedef {"not_a_positive_integer" | "above_100" | "above_crit" | "bad_regex" | "bad_path_list" | "bad_branch_list"
 *   | "not_on_or_off" | "unknown_key" | "bad_label" | "bad_target" | "duplicate" | "unreadable" | "bad_port"
 *   | "unknown_host" | "broken_host"} ConfigProblemReason
 *
 * @typedef {object} ConfigProblem
 * @property {"hosts.conf" | "settings.conf" | "pins.conf" | "snapshot"} file
 * @property {number | null} line
 * @property {string} key    setting key, host label or port
 * @property {string} value
 * @property {ConfigProblemReason} reason
 *
 * @typedef {"backend_timeout" | "backend_missing" | "bad_output" | "mod_bug" | "runtime_dir"} BackendFailureReason
 *
 * @typedef {object} BackendFailure
 * @property {BackendFailureReason} reason
 * @property {string} detail
 *
 * @typedef {object} CollectorState
 * @property {"ran" | "busy"} state  busy: the previous poll still held the poll lock
 * @property {number | null} busy_since
 *
 * @typedef {object} Guidance
 * @property {string} summary
 * @property {string} nextStep
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
 * @property {number | null} tree_cpu     CPU of the agent and every process under it
 * @property {number | null} tree_rss_kb
 * @property {number | null} tree_count
 * @property {string} tree_names          the busiest programs of the tree, comma-separated
 *
 * A pinned port that is not listening has pid null, process "" and agent_pid null.
 * @typedef {object} ListeningPort
 * @property {number} port
 * @property {number | null} pid
 * @property {string} process
 * @property {number | null} agent_pid
 * @property {boolean} pinned
 * @property {boolean} listening
 *
 * @typedef {object} Tunnel
 * @property {string} terminal  herdr-core terminal address
 * @property {string} label     host label
 * @property {number} remotePort
 * @property {number} localPort
 * @property {"running" | "exited"} state
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
 * @property {number | null} created_at        epoch seconds, from the first reflog entry
 * @property {number | null} last_activity_at  epoch seconds, change time of the index file
 * @property {string} merged_into              "" when not merged
 * @property {string} common_dir               absolute path of the main .git folder
 * @property {string} default_branch           e.g. "main"
 *
 * @typedef {"" | FailureReason | "missing_root"} MeasureReason
 *
 * @typedef {object} HostWorktrees
 * @property {"ok" | "failed" | "pending"} state
 * @property {number | null} measured_at
 * @property {MeasureReason} reason
 * @property {string} error
 * @property {number} total_kb
 * @property {WorktreeItem[]} items
 *
 * @typedef {"running" | "exited" | "paused" | "created" | "dead" | "restarting" | "removing"} DockerContainerState
 *
 * @typedef {object} DockerContainer
 * @property {string} id
 * @property {string} name
 * @property {string} image
 * @property {DockerContainerState} state
 * @property {number | null} created_at
 * @property {number | null} size_kb
 *
 * @typedef {object} DockerImage
 * @property {string} id
 * @property {string} repository
 * @property {string} tag
 * @property {number | null} size_kb
 * @property {boolean} is_dangling
 *
 * @typedef {object} DockerVolume
 * @property {string} name
 * @property {number | null} size_kb
 * @property {boolean} is_unused
 *
 * @typedef {object} HostDocker
 * @property {"ok" | "failed" | "pending" | "missing" | "denied" | "off"} state
 * @property {number | null} measured_at
 * @property {MeasureReason} reason
 * @property {string} error
 * @property {number} total_kb
 * @property {number} reclaimable_kb
 * @property {DockerContainer[]} containers
 * @property {DockerImage[]} images
 * @property {DockerVolume[]} volumes
 *
 * @typedef {object} HostSnapshot
 * @property {string} label
 * @property {string} target
 * @property {HostState} state
 * @property {FailureReason | ""} reason
 * @property {string} detail
 * @property {string} os
 * @property {string} load
 * @property {string} home
 * @property {number | null} polled_at
 * @property {number | null} updated_at
 * @property {number | null} down_since  when the host stopped answering
 * @property {number | null} rtt_ms      SSH round trip over the running master
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
 * @property {HostProblem[]} problems
 * @property {ProcessRow[]} processes
 * @property {AgentProcess[]} agents
 * @property {ListeningPort[]} ports
 * @property {HostWorktrees} worktrees
 * @property {HostDocker} docker
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
 * @property {number} docker_interval
 * @property {boolean} alerts
 * @property {boolean} docker
 *
 * @typedef {object} HostAlert
 * @property {"hot" | "port_down"} kind
 * @property {string} label
 * @property {number | null} cpu_pct
 * @property {number | null} mem_pct
 * @property {string} top_process
 * @property {number | null} port
 *
 * @typedef {object} Snapshot
 * @property {number} version
 * @property {number} generated_at
 * @property {string} hosts_file
 * @property {string} settings_file
 * @property {string} pins_file
 * @property {MonitorSettings} settings
 * @property {HostSnapshot[]} hosts
 * @property {boolean} worktrees_due
 * @property {boolean} docker_due
 * @property {CollectorState} collector
 * @property {ConfigProblem[]} problems
 * @property {HostAlert[]} alerts
 *
 * @typedef {{ ok: true, snapshot: Snapshot } | { ok: false, failure: BackendFailure }} SnapshotResult
 * @typedef {{ ok: true, stdout: string } | { ok: false, failure: BackendFailure }} BackendRunResult
 *
 * @typedef {object} MonitorState
 * @property {Snapshot | null} snapshot
 * @property {BackendFailure | null} error
 *
 * What store.js keeps in "herdwatch.state": one value, so one shared write per poll.
 * @typedef {object} MonitorRecord
 * @property {Snapshot | null} snapshot
 * @property {BackendFailure | null} error
 * @property {MonitorHistory} history
 * @property {PublishedSignatures} signatures
 *
 * The signatures of the worktree and Docker lists in their own shared keys: a reader skips a key whose signature
 * did not change.
 * @typedef {object} PublishedSignatures
 * @property {string} worktrees
 * @property {string} docker
 *
 * @typedef {object} MonitorData
 * @property {MonitorState | null} monitorState
 * @property {MonitorHistory} history
 * @property {PublishedSignatures} signatures
 *
 * @typedef {"pin" | "unpin" | "kill" | "worktree-remove" | "docker-stop" | "docker-rm" | "docker-prune"} ActionName
 *
 * @typedef {"bad_input" | "busy" | "host_down" | "not_owner" | "still_running" | "dirty" | "agent_inside"
 *   | "branch_not_merged" | "docker_denied" | "docker_missing" | "remote_error" | "backend_timeout"} ActionFailureReason
 *
 * @typedef {{ ok: true, message: string, data: Record<string, unknown> }
 *   | { ok: false, reason: ActionFailureReason, message: string, detail: string }} ActionResult
 *
 * @typedef {object} DialogOption
 * @property {string} key      e.g. "deleteBranch"
 * @property {string} label    e.g. "Also delete the branch feat/auth-refresh"
 * @property {boolean} checked
 * @property {string} flag     CLI flag added when checked, e.g. "--delete-branch"
 *
 * A failure the dialog answers with a second, stronger try (still running → force kill).
 * @typedef {object} DialogEscalation
 * @property {ActionFailureReason} reason
 * @property {string} confirmLabel
 * @property {string} flag
 *
 * @typedef {object} PendingAction
 * @property {string} id
 * @property {number} createdAt   epoch seconds
 * @property {ActionName} name
 * @property {string} label       host label
 * @property {string[]} args
 * @property {string} title
 * @property {string[]} details
 * @property {string[]} warnings  lines shown in yellow with a warning glyph
 * @property {DialogOption[]} options
 * @property {string} confirmLabel
 * @property {boolean} isDestructive  the Confirm button is red
 * @property {DialogEscalation | null} escalation
 *
 * @typedef {object} DialogState
 * @property {string} pendingId
 * @property {boolean} isRunning
 * @property {boolean} isFinished      the action did part of its work; only Close is left
 * @property {boolean} isEscalated
 * @property {{ message: string, detail: string } | null} failure
 * @property {Record<string, boolean>} checked
 *
 * @typedef {object} DialogView
 * @property {PendingAction | null} pending
 * @property {DialogState} state
 * @property {(key: string, cx: ModContext) => void} onToggleOption
 * @property {(cx: ModContext) => void} onConfirm
 * @property {() => void} onCancel
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
 * @typedef {object} ChartMarker
 * @property {number} position
 * @property {HostEvent["kind"]} kind
 * @property {string} text
 *
 * @typedef {object} MonitorHistory
 * @property {Record<string, HostSeries>} hosts
 * @property {Record<string, (number | null)[]>} agents
 * @property {Record<string, HostEvent[]>} events
 * @property {Record<string, number[]>} pids
 *
 * @typedef {Record<string, HostWorktrees>} WorktreesByHost
 * @typedef {Record<string, HostDocker>} DockerByHost
 *
 * @typedef {object} PollLease
 * @property {string} owner
 * @property {number} at
 *
 * @typedef {object} HerdrAgent
 * @property {string | null} machine
 * @property {string} app
 * @property {string} cwd
 * @property {AgentState} state
 *
 * @typedef {object} AgentView
 * @property {AgentProcess} process
 * @property {AgentState} state
 * @property {(number | null)[]} cpuHistory
 *
 * @typedef {object} WorktreeFlags
 * @property {boolean} hasAgent
 * @property {boolean} isStale
 * @property {Set<WorktreeFilter>} filters  the filters that show this worktree
 *
 * @typedef {object} WorktreeFacts
 * @property {Map<WorktreeItem, WorktreeFlags>} flagsOfWorktree
 * @property {Record<WorktreeFilter, number>} counts
 * @property {number} reclaimableKib  the space of the stale worktrees
 * @property {number} largestKib
 *
 * @typedef {object} ConsoleChoices
 * @property {string | null} host
 * @property {ConsoleTab} tab
 * @property {number} range
 * @property {WorktreeFilter} filter
 * @property {ProcessSort} sort
 *
 * @typedef {object} BarView
 * @property {MonitorState | null} monitorState
 * @property {boolean} isConsoleOpen
 * @property {string | null} shortcut
 * @property {() => void} onToggleConsole
 *
 * @typedef {object} PortActions
 * @property {(label: string, port: ListeningPort, cx: ModContext) => void} onTogglePin
 * @property {(host: HostSnapshot, port: ListeningPort, cx: ModContext) => void} onOpenPort
 * @property {(tunnel: Tunnel, cx: ModContext) => void} onStopTunnel
 *
 * @typedef {object} ConsoleView
 * @property {MonitorState | null} monitorState
 * @property {MonitorHistory} history
 * @property {WorktreesByHost} worktrees
 * @property {DockerByHost} docker
 * @property {Tunnel[]} tunnels
 * @property {Record<string, string>} portNotes  "<label>:<port>" → a tunnel that opens, or why the last port action failed
 * @property {string | null} checkingPruneOn  the host whose Docker prune preview runs now
 * @property {HostSnapshot | null} host
 * @property {AgentView[]} agents
 * @property {ConsoleTab} tab
 * @property {number} rangeSamples
 * @property {ProcessSort} sort
 * @property {WorktreeFilter} worktreeFilter
 * @property {string | null} shortcut
 * @property {boolean} hasKeyboard
 * @property {boolean} isWide
 * @property {(label: string, cx: ModContext) => void} onHost
 * @property {(tab: ConsoleTab, cx: ModContext) => void} onTab
 * @property {(samples: number, cx: ModContext) => void} onRange
 * @property {(sort: ProcessSort, cx: ModContext) => void} onSort
 * @property {(filter: WorktreeFilter, cx: ModContext) => void} onWorktreeFilter
 * @property {boolean} showAllWorktrees  false: the worktrees tab draws the first rows and a "show more" button
 * @property {(cx: ModContext) => void} onShowAllWorktrees
 * @property {() => void} onClose
 * @property {PortActions} ports
 * @property {(host: HostSnapshot, pid: number) => void} onKill
 * @property {(host: HostSnapshot, worktree: WorktreeItem) => void} onDeleteWorktree
 * @property {(host: HostSnapshot, container: DockerContainer, name: "docker-stop" | "docker-rm") => void} onDockerContainer
 * @property {(host: HostSnapshot, cx: ModContext) => void} onDockerPrune
 */
export {};
