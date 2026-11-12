# Herdwatch - SSH hosts monitor

A [Herdr](https://herdr.dev) mod: a btop-style monitor for the SSH hosts where your coding agents run.

![Herdwatch - SSH hosts monitor](preview.png)

- **Pill** in the tab row: CPU of each host, always visible. Click it or press `cmd-shift-m` to open the console.
- **Console**: CPU and memory history charts with agent events, per-core load, disk, network and GPU.
- **Agents**: the coding agent sessions on each host (Claude Code, Codex, Gemini, Copilot, Cursor, OpenCode, Amp, omp, Pi and about 25 more), with their branch and Herdr's status.
- **Ports**: listening ports and the agent that started each one.
- **Worktrees**: the size and health of every git worktree, from any tool (Claude, Codex, Cursor, Conductor, Gemini, Qwen and others).
- **Processes**: the top 30, sorted by CPU or memory.

## Install

Ask your agent in Herdr:

> Add the Herdr mod from github.com/bryan-duarte/herdwatch

Or do it by hand:

1. Copy `mods/herdwatch/` into `~/.config/herdr-app/mods/`.
2. Add the `cmd-shift-m` key from `keys.json` to `~/.config/herdr-app/keys.json`.
3. Add your hosts to `~/.config/herdwatch/hosts.conf`, one `label  ssh-target` per line. The file appears after the first poll.

Each host must accept an SSH key login without a prompt.

## What it does on your machines

- Every 5 s it runs `ssh` to each host in `hosts.conf` and reads CPU, memory, disk, network, processes, agents and ports with a short POSIX `sh` script.
- Every 5 minutes it runs `find`, `du` and `git status` on each host to measure worktrees.
- It writes only to `~/.config/herdwatch/`, `~/.local/state/herdwatch/` and `/tmp/herdwatch-<uid>/`. It never sources your config files.

## Requirements

- Herdr.app on macOS or Linux, Bash 3.2 or later, and `ssh`.
- On each host: POSIX `sh`, `awk`, `ps`, `df` and `git`. Linux also needs `top` and `ss`; macOS needs `lsof`, `vm_stat` and `iostat`.

`RECIPE.md` describes the full build. License: MIT.
