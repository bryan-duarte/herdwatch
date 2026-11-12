# Herdwatch - SSH server monitor for coding agents

A btop and htop style system monitor for remote servers, VPS and homelab machines where AI agents like Claude Code and Codex run. A pill in the tab row shows each host's CPU; a click or `cmd-shift-m` opens a Tokyo Night dashboard: CPU, memory (RAM), swap, disk, network and GPU charts, per-core load, agent sessions and their state, listening ports, git worktree disk usage, top processes and hot host alerts. A multi-host SSH monitor and resource monitor, with nothing to install on the server.

![Herdwatch - SSH server monitor for coding agents](preview.png)

## What you see

All colors are fixed Tokyo Night: background `#1a1b26`, dark `#16161e`, highlight `#292e42`, border `#3b4261`, comment `#565f89`, text `#c0caf5`, blue `#7aa2f7`, cyan `#7dcfff`, teal `#73daca`, green `#9ece6a`, yellow `#e0af68`, orange `#ff9e64`, red `#f7768e`, magenta `#bb9af7`, purple `#9d7cd8`. All text is JetBrains Mono.

**Interaction rule:** everything clickable has a frame or fill, a pointer cursor, a hover state (`#292e42`), a pressed state (`#3b4261`) and a tooltip. Nothing else reacts to hover.

- **Pill** (a 340 px layout block at the right of the tab row; on the first install, Herdr docks it as a 36 px strip at the top of the window): 28 px high, radius 7, `#16161e`, border `#292e42` (blue while the console is open or on hover). Per host: the label in bold blue, then two readings, CPU and memory: each its glyph (`cpu`, `memory-stick`), a 4-cell meter (CPU green to red, memory cyan to magenta) and the percent (yellow with `!` at WARN, red with `!!` at CRIT). Hosts split by `│`. Then `│` and a side-panel icon, filled blue while the console is open. `✕` for a down host, `auth` for a refused login, `…` before the first poll, `?` after stale values.
- **Console header** (40 px, `#16161e`): `herdwatch`, one tab per host with a health dot (green, yellow at WARN, red at CRIT or down), the range control `2m | 5m | 10m`, and a framed close button.
- **Tab strip**: `overview`, `agents N`, `ports N`, `worktrees N`, `procs 30`. The open tab is framed and filled.
- **overview**: a btop box titled `¹kali` with `linux · up 3h` in the top edge. Inside, top to bottom: `cores` (one cell per core, colored and dimmed by load); then CPU and then memory, the two readings that matter most, each a full-width block: its row (label, 20-cell meter) with the bold percent and the detail on a line under the meter (`8 cores`; used / total GiB and swap), then its area chart (CPU green to red with an end dot and markers for agent start, agent end and alerts; memory cyan to magenta with swap as a dashed purple line), 46 px high, growing from the right. Then rows: `disk` (20-cell meter, with the percent, free space and read and write rate under it), `net` (two sparklines, down and up rate), `gpu` (when the host has an NVIDIA GPU; numbers under the meter, as disk), `wt` (worktree total, count, stale count). Below: the agents box.
- **agents**: one row per coding agent session: the agent's mark and name, state (`working` blue, `needs you` yellow, `idle` gray, `done` green), repository and branch (or the folder), a 2.5-minute CPU sparkline (wide panes), CPU and uptime.
- **ports**: listening TCP ports, agent-owned first: `:3000`, process, the agent that started it (found through the parent chain), and that agent's worktree. Ports of other users show `other user`.
- **worktrees**: filter chips with counts (`all`, `stale > 14d`, `uncommitted`, `agent running`, `behind upstream`), the space reclaimable from stale worktrees, and a virtual list that fills the free height of the pane: size (teal to red by share of the largest), share meter, tool chip, repository, branch (`●` when an agent works there), `±changed files` or `clean`, and days since the last commit (orange when stale).
- **procs**: a `CPU | MEM` sort control, then a table of the top 30: the agent's mark (or `●` for an agent run by node, bun or python), pid, program, CPU meter (wide panes), `cpu%` and `mem%` headers that also sort.
- **Footer**: `● agent │ [c] cpu [m] mem [1-4] host [⌘⇧M] toggle`, and `keys on` or `click the pane for keys`.
- **Agent marks**: each agent shows its own mark at 14 px, the way Herdr's sidebar draws it (a picture as it is, a one-color glyph in the text color). The marks of agents in Herdr's program table come from Herdr's `icons/` folder; the mod ships the others in `icons/agents/` (sources and licenses in `icons/agents/LICENSES.md`). An agent without a mark gets the Herdwatch pixel sheep in the agent's own accent color.
- **Navigation glyphs**: 12 px Lucide glyphs (ISC, in `icons/ui/`) in the text color of their control, one glyph per concept: `gauge` overview, `bot` agents, `plug` ports, `folder-git-2` worktrees, `activity` procs, `server` hosts, `cpu`, `memory-stick`, `hard-drive`, `arrow-down-up` network, `microchip` GPU, `git-branch`, `history` range, `arrow-down-wide-narrow` sort, `triangle-alert` notice, `keyboard` keys, and `layers`, `archive`, `file-diff`, `bot`, `arrow-down-to-line` on the worktree filters. In a pane narrower than 560 px, a tab that is not open shows only its glyph and count, and the agent columns show only the mark; the tooltips give the names.

## How it behaves

- One copy polls at a time: it runs `bin/herdwatch snapshot` every 5 s (one parallel SSH poll per host) and writes three shared keys: `herdwatch.state` (the snapshot without worktree lists), `herdwatch.history` (120 samples per host, 30 per agent, events), and `herdwatch.worktrees` (written only when a new measure arrives). The poller holds a 12 s lease in `herdwatch.poller`; when the pill is not shown, the console takes the lease, so its data stays fresh. Other copies only read.
- When the snapshot says `worktrees_due`, the poller also runs `bin/herdwatch worktrees`; the backend measures every 5 minutes.
- First run: the backend copies `examples/hosts.conf` and `examples/settings.conf` to `~/.config/herdwatch/`. With no hosts, the pill shows `herdwatch: add hosts` and the console names the file to edit.
- Agent states come from Herdr.app's `agents()` when a Herdr agent on the same machine has the same app and folder; other agents are `working` from 3% CPU, else `idle`.
- Each console keeps its own host, tab, range and worktree filter; the CPU/MEM sort is shared.
- Keys in the console (click it first): `c` and `m` sort, `1` to `4` choose a host. `cmd-shift-m` or a click on the pill opens and closes the console; the focus returns to your terminal.
- Alerts: ALERT_POLLS polls in a row at or above CRIT give one warning toast and the `blocked` sound, and a red marker on the CPU chart.

## Built from

- `mods/herdwatch/` (one mod; `props.view: "detail"` is the console, any other copy is the pill; `mod.json` is `{"place": "top", "size": 36, "title": "Herdwatch - SSH hosts monitor", "focusable": true}`):
  - `main.js` (one view class for the pill and the console), `poller.js` (the poll lease, the poll, alerts), `backend.js` (runs `bin/herdwatch` and checks its JSON), `store.js` (Herdr shared keys and saved console choices), `console-pane.js` (open, close and the shortcut label), `snapshot.js`, `history.js`, `worktrees.js`, `agents.js` (joins host processes with `agents()`), `health.js`, `format.js`, `palette.js`, `schemas.js` (the data shapes). `views/`: `bar.js` (pill), `console.js` (the tabbed console), one `*-panel.js` file per tab, `charts.js` (`paint_path` area charts, sparklines, core strip) and `widgets.js` (btop box, meters, chips, keycaps, segmented control, tab strip, filter chips, icon button).
  - `bin/herdwatch {snapshot|worktrees}` and `lib/` (Bash 3.2 + POSIX awk): config, collector, locks (`lock.sh`), SSH with watchdogs and a detached ControlMaster per host (`ssh.sh`), records, rates from counters between polls, alerts, JSON output.
  - `lib/probe/` (POSIX sh parts that the collector joins and sends over SSH stdin, about 1 s): CPU and per-core load, load, memory, swap, disk, disk and network counters, GPU via `nvidia-smi`, uptime, the top processes by CPU and by memory, agent sessions (35 agent commands, from Claude Code, Codex, Gemini, Copilot, Cursor and OpenCode to omp, Kimi, Qoder and Antigravity: the command name, the script of `node`/`bun`/`deno`/`python3.x`, or a native `<agent>/versions/<release>` install; named with Herdr's program table keys such as `cursor` and `kiro`; `cwd` from `/proc` or `lsof`; branch and repository from git), and listening ports (`ss` or `lsof`) with the owning agent.
  - `lib/worktrees_probe.sh`: git linked worktrees from git's own records, with size, changed files, ahead/behind and last commit. The tool comes from the folder: `<repo>/.<tool>/worktrees/` (Claude, Gemini, Qwen, Qoder, Letta), `~/.cursor/worktrees`, `$CODEX_HOME/worktrees`, `~/.factory/worktrees` (Droid), `~/.omp/wt`, Conductor; else `git`.
- Charts: `PathBuilder.fill()` and `PathBuilder.stroke(w)` with percent coordinates, painted with `window.paint_path(path, Background.linear_gradient(...))` in an absolutely placed layer.
- Worktree list: `uniform_list(id, count, key, (range) => rows)` in a `flex_1().min_h(0)` box; the worktrees tab has no outer scroll.
- Layout: a `row` in place of the tab-row block: `[{the tabs block}, {"id": "herdwatch-bar", "type": "block", "size": {"px": 340}, "content": {"mod": "herdwatch", "props": {"view": "bar"}}}]`. `keys.json`: `"cmd-shift-m": "herdwatch.toggle"`.

## Watch out

- **It runs programs and reaches the network.** Every 5 s it runs `ssh` to each host in `~/.config/herdwatch/hosts.conf`; every 5 minutes it runs `find`, `du` and `git status` on each host. Hosts need a key login without a prompt. Config files are data: never sourced; bad targets and bad worktree roots are refused.
- Shared state outlives a mod update. Validate it when you read it: an old history shape broke every poll until the reader started over with an empty history.
- In a mod pane, do not put `.on_mouse_down(stop_propagation)` on a clickable element: it cancels `on_click`. Never place clickable parts outside their parent with negative offsets.
- `uniform_list` rows need `.w_full()`, or wide rows push the right columns out of view.
- In POSIX `sh`, a tab in `IFS` is whitespace: two tabs in a row merge, so empty fields shift. Write a placeholder for empty fields.
- On macOS a program path can contain spaces (`Application Support`), so read it from `comm`, not from `args`.
- Install by copying `mods/herdwatch/` into `~/.config/herdr-app/mods/`; a symlink does not hot-reload.
- `<mod>.<command>` reaches shown copies only, so `cmd-shift-m` works while the pill is shown. Keep the pill in the layout; move the first-install strip into the tab row with the Layout entry above.
- Requirements on each host: POSIX `sh`, `awk`, `ps`, `df`, `git`; Linux also `top` and `ss`, macOS `lsof`, `vm_stat` and `iostat`. On this machine: Bash 3.2 or later and `ssh`.
- Background clicks do not reach the mod; test with the window in front. `herdr-app shot` returns the last rendered frame.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/herdwatch` passes and `herdr-app status` shows no errors.
- The pill shows `kali ▮▯▯▯ n%`; a click opens the console and the focus stays in the terminal.
- Each tab opens with a click, and its count matches the rows; `2m`, `5m` and `10m` change the charts.
- `MEM`, the `mem%` header and the `m` key sort by memory; `c` sorts by CPU.
- With the console shown and no pill, the console takes the poll lease within 20 s, and then `herdwatch.state` is never older than 10 s.
- A new agent session appears in `agents` within 5 s; its port appears in `ports` with the agent and worktree.
- The worktree list renders only the visible rows and shows the changed files and age columns in a narrow pane.
