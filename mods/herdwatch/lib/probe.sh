# herdwatch probe v2. The collector sends this file over ssh stdin: sh -s -- <top_n>
# It prints key=value lines, then tab-separated sections: --procs-- (the top_n processes by CPU plus the
# top_n by memory), --agents-- (one row per coding agent session) and --ports-- (listening TCP ports).
LC_ALL=C
export LC_ALL
default_top_n=30
top_n="${1:-$default_top_n}"
cpu_sample_seconds=0.5
top_sample_frames=2
wide_terminal_columns=512
max_parent_hops=20
# The commands that start a coding agent. An npm, bun or pip install runs as `node|bun|python <bin folder>/<command>`.
agent_programs=' claude codex cursor-agent opencode aider gemini agy omp amp goose droid copilot crush qwen kiro-cli pi pig kimi
  cline plandex pdx kilo kilocode auggie cn grok devin letta hermes qodercli qoder mastracode jules openhands dsh-tui '
agent_programs=" $(printf '%s\n' "$agent_programs" | tr -s ' \n' '  ' | sed 's/^ *//; s/ *$//') "
agent_name_pattern=$(printf '%s' "$agent_programs" | sed 's/^ *//; s/ *$//; s/ /|/g')
candidate_pattern='(^|/)('"$agent_name_pattern"')([.][mc]?js)?$|/('"$agent_name_pattern"')/versions/|/[.]claude/remote/ccd-cli/'
interpreter_pattern='(^|/)(node|bun|deno|python[0-9.]*)$'
tab=$(printf '\t')
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

print_process_columns() {
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5"
}

print_process_row() {
  program_name=${4##*/}
  program_name=${program_name%:}
  print_process_columns "$1" "$2" "$3" "${program_name:-?}" "$4"
}

select_top_processes() {
  process_rows=$(cat)
  {
    printf '%s\n' "$process_rows" | sort -k2,2 -rn | head -n "$top_n"
    printf '%s\n' "$process_rows" | sort -k3,3 -rn | head -n "$top_n"
  } | awk 'NF && !seen[$1]++'
}

print_disk_usage() {
  df -Pk "$1" | awk 'NR == 2 { sub("%", "", $5); printf "disk_pct=%s\ndisk_total_kb=%s\ndisk_used_kb=%s\n", $5, $2, $3 }'
}

print_gpu() {
  command -v nvidia-smi >/dev/null 2>&1 || return 0
  nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -n 1 |
    awk -F', *' 'NF >= 4 { printf "gpu_name=%s\ngpu_pct=%d\ngpu_mem_used_mib=%d\ngpu_mem_total_mib=%d\n", $1, $2, $3, $4 }'
}

# The key of Herdr.app's program table (programs.json) for an agent command, so a process matches the agent Herdr reports.
canonical_agent() {
  case "$1" in
    cursor-agent) echo cursor ;;
    kiro-cli) echo kiro ;;
    agy) echo antigravity ;;
    qodercli) echo qoder ;;
    kilocode) echo kilo ;;
    pdx) echo plandex ;;
    cn) echo continue ;;
    *) echo "$1" ;;
  esac
}

agent_from_command_name() {
  command_name=${1##*/}
  command_name=${command_name%.js}
  command_name=${command_name%.mjs}
  command_name=${command_name%.cjs}
  case "$agent_programs" in
    *" $command_name "*) canonical_agent "$command_name"; return 0 ;;
  esac
  return 1
}

# Native installers keep each release in <name>/versions/<release>, so the program file has the release as its name.
agent_from_install_folder() {
  case "$1" in
    */versions/*) install_folder=${1%%/versions/*} ;;
    *) return 1 ;;
  esac
  agent_from_command_name "${install_folder##*/}"
}

agent_from_program() {
  program_path="$1"
  script_path="$2"
  case "$program_path" in
    */.claude/remote/ccd-cli/*) echo claude; return 0 ;;
    */.claude/remote/srv/* | *claude-desktop*) return 1 ;;
  esac
  launched_path="$program_path"
  case "${program_path##*/}" in
    node | bun | deno | python | python[0-9]*) launched_path="$script_path" ;;
  esac
  agent_from_install_folder "$launched_path" || agent_from_command_name "$launched_path"
}

repository_details() {
  git_output=$(git -C "$1" rev-parse --abbrev-ref HEAD --path-format=absolute --git-common-dir 2>/dev/null) || return 0
  branch=$(printf '%s\n' "$git_output" | sed -n 1p)
  common_dir=$(printf '%s\n' "$git_output" | sed -n 2p)
  common_dir=${common_dir%/}
  case "$common_dir" in
    */.git) repository=${common_dir%/.git} ;;
    *) repository=${common_dir%.git} ;;
  esac
  printf '%s\t%s' "$branch" "${repository##*/}"
}

print_agent_rows() {
  candidates_file="$1"
  agents_file="$work_dir/agents"
  : >"$agents_file"
  while IFS="$tab" read -r pid ppid elapsed cpu mem program_path script_path cwd; do
    app=$(agent_from_program "$program_path" "$script_path") || continue
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$ppid" "$app" "$elapsed" "$cpu" "$mem" "$cwd" >>"$agents_file"
  done <"$candidates_file"
  awk -F '\t' 'NR == FNR { app_of[$1] = $3; next } app_of[$2] != $3' "$agents_file" "$agents_file" |
    while IFS="$tab" read -r pid ppid app elapsed cpu mem cwd; do
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$app" "$elapsed" "$cpu" "$mem" "$cwd" "$(repository_details "$cwd")"
    done
}

print_port_rows() {
  ports_file="$1"
  parents_file="$2"
  agent_pids_file="$3"
  awk -F '\t' -v hops="$max_parent_hops" '
    FILENAME == ARGV[1] { parent_of[$1] = $2; next }
    FILENAME == ARGV[2] { is_agent[$1] = 1; next }
    !seen[$1 FS $2]++ {
      owner = ""; current = $2
      for (step = 0; step < hops && current != "" && current > 1; step++) {
        if (current in is_agent) { owner = current; break }
        current = parent_of[current]
      }
      printf "%s\t%s\t%s\t%s\n", $1, $2, $3, owner
    }' "$parents_file" "$agent_pids_file" "$ports_file"
}

# The script of an interpreter is its first argument that is not a flag (node --max-old-space-size=N cli.js, python -m aider).
filter_agent_candidates() {
  awk -v pattern="$candidate_pattern" -v interpreters="$interpreter_pattern" '{
    script_path = "-"
    for (i = 7; i <= NF; i++) if ($i !~ /^-/) { script_path = $i; break }
    if ($6 ~ pattern || ($6 ~ interpreters && script_path ~ pattern)) print $1, $2, $3, $4, $5, $6, script_path
  }'
}

linux_cpu_ticks() {
  awk '/^cpu/ { idle = $5 + $6; total = 0; for (i = 2; i <= NF; i++) total += $i; print $1, total, idle }' /proc/stat
}

linux_print_cpu() {
  awk 'NR == FNR { total[$1] = $2; idle[$1] = $3; next }
    {
      total_delta = $2 - total[$1]; idle_delta = $3 - idle[$1]
      busy = total_delta > 0 ? int(100 * (total_delta - idle_delta) / total_delta) : 0
      if ($1 == "cpu") cpu_line = "cpu_pct=" busy
      else cores = cores (cores == "" ? "" : " ") busy
    }
    END { print cpu_line; print "cores=" cores }' "$1" "$2"
}

linux_sample_top() {
  COLUMNS="$wide_terminal_columns" top -b -n "$top_sample_frames" -d "$cpu_sample_seconds" >"$1" 2>/dev/null &&
    grep -q '^ *PID ' "$1"
}

linux_processes_from_top() {
  awk -v last_frame="$top_sample_frames" '
    function column(name) { return (name in header_column) ? $header_column[name] : "?" }
    /^ *PID / { frame++; for (i = 1; i <= NF; i++) header_column[$i] = i; next }
    frame == last_frame && NF { print column("PID"), column("%CPU"), column("%MEM"), column("COMMAND") }
  ' "$1"
}

linux_name_processes() {
  while read -r pid cpu mem kernel_name; do
    program_path=$(tr '\0' '\n' 2>/dev/null <"/proc/$pid/cmdline" | head -n 1)
    program_path=${program_path%% *}
    if [ -n "$program_path" ]; then
      print_process_row "$pid" "$cpu" "$mem" "$program_path"
    else
      print_process_columns "$pid" "$cpu" "$mem" "$kernel_name" "$kernel_name"
    fi
  done
}

linux_print_memory() {
  awk '/^MemTotal:/ { total = $2 } /^MemAvailable:/ { available = $2 }
       /^MemFree:/ { free = $2 } /^Buffers:/ { buffers = $2 } /^Cached:/ { cached = $2 }
       /^SwapTotal:/ { swap_total = $2 } /^SwapFree:/ { swap_free = $2 }
       END { if (available == "") available = free + buffers + cached; printf "mem_total_kb=%d\nmem_avail_kb=%d\nswap_total_kb=%d\nswap_used_kb=%d\n", total, available, swap_total, swap_total - swap_free }' /proc/meminfo
}

linux_print_io_counters() {
  awk '$3 ~ /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)$/ { read += $6; written += $10 }
       END { printf "disk_read_bytes=%.0f\ndisk_write_bytes=%.0f\n", read * 512, written * 512 }' /proc/diskstats 2>/dev/null
  awk 'NR > 2 { line = $0; sub(/^ */, "", line); split(line, parts, ":"); split(parts[2], values, " ")
         if (parts[1] != "lo") { received += values[1]; sent += values[9] } }
       END { printf "net_rx_bytes=%.0f\nnet_tx_bytes=%.0f\n", received, sent }' /proc/net/dev 2>/dev/null
}

linux_cpu_by_pid() {
  awk -v last_frame="$top_sample_frames" '
    /^ *PID / { frame++; for (i = 1; i <= NF; i++) header_column[$i] = i; next }
    frame == last_frame && NF && ("%CPU" in header_column) { print $header_column["PID"] "\t" $header_column["%CPU"] }
  ' "$1"
}

linux_agent_candidates() {
  cpu_by_pid_file="$1"
  ps -eo pid=,ppid=,etimes=,pcpu=,pmem=,args= 2>/dev/null | filter_agent_candidates |
    while read -r pid ppid elapsed cpu mem program_path script_path; do
      agent_from_program "$program_path" "$script_path" >/dev/null || continue
      sampled_cpu=$(awk -F '\t' -v pid="$pid" '$1 == pid { print $2; exit }' "$cpu_by_pid_file")
      cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$ppid" "$elapsed" "${sampled_cpu:-$cpu}" "$mem" "$program_path" "${script_path:--}" "$cwd"
    done
}

linux_listening_ports() {
  command -v ss >/dev/null 2>&1 || return 0
  ss -ltnpH 2>/dev/null | awk '{
    port = $4; sub(/.*:/, "", port)
    pid = ""; name = ""
    if (match($0, /pid=[0-9]+/)) pid = substr($0, RSTART + 4, RLENGTH - 4)
    if (match($0, /\(\("[^"]+"/)) name = substr($0, RSTART + 3, RLENGTH - 4)
    if (port ~ /^[0-9]+$/) printf "%s\t%s\t%s\n", port, pid, name
  }'
}

linux_probe() {
  echo "os=linux"
  echo "ncpu=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo)"
  awk '{ printf "uptime_seconds=%d\n", $1 }' /proc/uptime
  top_output="$work_dir/top"
  linux_cpu_ticks >"$work_dir/ticks_before"
  if linux_sample_top "$top_output"; then
    process_source='top'
  else
    sleep "$cpu_sample_seconds"
    process_source='ps'
    : >"$top_output"
  fi
  linux_cpu_ticks >"$work_dir/ticks_after"
  linux_print_cpu "$work_dir/ticks_before" "$work_dir/ticks_after"
  awk '{ printf "load=%s %s %s\n", $1, $2, $3 }' /proc/loadavg
  linux_print_memory
  echo "procs=$(find /proc -maxdepth 1 -name '[0-9]*' -type d 2>/dev/null | wc -l | tr -d ' ')"
  print_disk_usage /
  linux_print_io_counters
  print_gpu
  echo "--procs--"
  if [ "$process_source" = top ]; then
    linux_processes_from_top "$top_output" | select_top_processes | linux_name_processes
  else
    ps -eo pid=,pcpu=,pmem=,comm= 2>/dev/null | select_top_processes | linux_name_processes
  fi
  linux_cpu_by_pid "$top_output" >"$work_dir/cpu_by_pid"
  linux_agent_candidates "$work_dir/cpu_by_pid" >"$work_dir/candidates"
  echo "--agents--"
  print_agent_rows "$work_dir/candidates" | tee "$work_dir/agent_rows"
  cut -f1 "$work_dir/agent_rows" >"$work_dir/agent_pids"
  ps -eo pid=,ppid= 2>/dev/null | awk '{ printf "%s\t%s\n", $1, $2 }' >"$work_dir/parents"
  linux_listening_ports >"$work_dir/ports"
  echo "--ports--"
  print_port_rows "$work_dir/ports" "$work_dir/parents" "$work_dir/agent_pids"
}

darwin_name_processes() {
  while read -r pid cpu mem arguments; do
    executable=$(ps -o comm= -p "$pid")
    [ -n "$executable" ] || continue
    case "$arguments" in
      "$executable"*) program_path=$executable ;;
      *) program_path=${arguments%% *} ;;
    esac
    print_process_row "$pid" "$cpu" "$mem" "$program_path"
  done
}

darwin_print_io_counters() {
  iostat -I -d -c 1 2>/dev/null | awk 'NR == 3 { for (i = 3; i <= NF; i += 3) megabytes += $i } END { printf "disk_io_bytes=%.0f\n", megabytes * 1048576 }'
  netstat -ibn 2>/dev/null | awk '$3 ~ /^<Link#/ && $1 !~ /^lo/ && !seen[$1]++ {
      if (NF >= 11) { received += $7; sent += $10 } else { received += $6; sent += $9 } }
    END { printf "net_rx_bytes=%.0f\nnet_tx_bytes=%.0f\n", received, sent }'
}

darwin_agent_candidates() {
  ps -A -o pid=,ppid=,etime=,%cpu=,%mem=,comm= 2>/dev/null |
    awk -v pattern="$candidate_pattern" -v interpreters="$interpreter_pattern" '{
      program_path = $0
      sub(/^ *[0-9]+ +[0-9]+ +[^ ]+ +[^ ]+ +[^ ]+ +/, "", program_path)
      if (program_path ~ pattern || program_path ~ interpreters) printf "%s\t%s\t%s\t%s\t%s\t%s\n", $1, $2, $3, $4, $5, program_path
    }' |
    while IFS="$tab" read -r pid ppid elapsed cpu mem program_path; do
      script_path=''
      case "$program_path" in
        */node | */bun | */deno | */python* | node | bun | deno | python*)
          script_path=$(ps -o args= -p "$pid" 2>/dev/null | awk '{ for (i = 2; i <= NF; i++) if ($i !~ /^-/) { print $i; exit } }') ;;
      esac
      agent_from_program "$program_path" "${script_path:--}" >/dev/null || continue
      elapsed_seconds=$(printf '%s\n' "$elapsed" | awk -F '[-:]' '{ seconds = 0; for (i = 1; i <= NF; i++) { unit = (NF - i == 3) ? 86400 : (NF - i == 2) ? 3600 : (NF - i == 1) ? 60 : 1; seconds += $i * unit } print seconds }')
      cwd=$(lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$ppid" "$elapsed_seconds" "$cpu" "$mem" "$program_path" "${script_path:--}" "$cwd"
    done
}

darwin_listening_ports() {
  lsof -nP -iTCP -sTCP:LISTEN -Fpcn 2>/dev/null | awk '
    /^p/ { pid = substr($0, 2) }
    /^c/ { name = substr($0, 2) }
    /^n/ { port = substr($0, 2); sub(/.*:/, "", port); if (port ~ /^[0-9]+$/) printf "%s\t%s\t%s\n", port, pid, name }'
}

darwin_probe() {
  echo "os=darwin"
  cpu_count=$(sysctl -n hw.ncpu)
  echo "ncpu=$cpu_count"
  boot_seconds=$(sysctl -n kern.boottime | sed 's/^{ sec = \([0-9]*\).*/\1/')
  echo "uptime_seconds=$(($(date +%s) - boot_seconds))"
  ps -A -o %cpu= | awk -v cores="$cpu_count" '{ sum += $1 } END { busy = sum / cores; if (busy > 100) busy = 100; printf "cpu_pct=%d\n", busy }'
  sysctl -n vm.loadavg | awk '{ printf "load=%s %s %s\n", $2, $3, $4 }'
  echo "mem_total_kb=$(($(sysctl -n hw.memsize) / 1024))"
  vm_stat | awk '/page size of/ { page_size = $8 } /^Pages free/ { free = $3 } /^Pages inactive/ { inactive = $3 }
       /^Pages speculative/ { speculative = $3 }
       END { printf "mem_avail_kb=%d\n", (free + inactive + speculative) * page_size / 1024 }'
  sysctl -n vm.swapusage | awk '{ gsub("M", ""); printf "swap_total_kb=%d\nswap_used_kb=%d\n", $3 * 1024, $6 * 1024 }'
  echo "procs=$(ps -A -o pid= | wc -l | tr -d ' ')"
  data_volume=/System/Volumes/Data
  [ -d "$data_volume" ] || data_volume=/
  print_disk_usage "$data_volume"
  darwin_print_io_counters
  echo "--procs--"
  ps -A -o pid=,%cpu=,%mem=,args= | select_top_processes | darwin_name_processes
  darwin_agent_candidates >"$work_dir/candidates"
  echo "--agents--"
  print_agent_rows "$work_dir/candidates" | tee "$work_dir/agent_rows"
  cut -f1 "$work_dir/agent_rows" >"$work_dir/agent_pids"
  ps -A -o pid=,ppid= 2>/dev/null | awk '{ printf "%s\t%s\n", $1, $2 }' >"$work_dir/parents"
  darwin_listening_ports >"$work_dir/ports"
  echo "--ports--"
  print_port_rows "$work_dir/ports" "$work_dir/parents" "$work_dir/agent_pids"
}

echo "probe=2"
echo "home=$HOME"
case "$(uname -s)" in
  Linux) linux_probe ;;
  Darwin) darwin_probe ;;
  *) echo "os=unsupported" ;;
esac
exit 0
