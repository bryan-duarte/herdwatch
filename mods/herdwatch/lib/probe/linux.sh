# shellcheck shell=sh
linux_cpu_sample_seconds=0.5
linux_top_sample_frames=2
linux_wide_terminal_columns=512
linux_bytes_per_disk_sector=512
linux_disk_device_pattern='^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)$'

linux_cpu_ticks() {
  awk '/^cpu/ { idle = $5 + $6; total = 0; for (i = 2; i <= NF; i++) total += $i; print $1, total, idle }' /proc/stat
}

linux_print_cpu() {
  awk -v percent_scale="$percent_scale" '
    NR == FNR { total[$1] = $2; idle[$1] = $3; next }
    {
      total_delta = $2 - total[$1]; idle_delta = $3 - idle[$1]
      busy = total_delta > 0 ? int(percent_scale * (total_delta - idle_delta) / total_delta) : 0
      if ($1 == "cpu") cpu_line = "cpu_pct=" busy
      else cores = cores (cores == "" ? "" : " ") busy
    }
    END { print cpu_line; print "cores=" cores }' "$1" "$2"
}

linux_sample_top() {
  COLUMNS="$linux_wide_terminal_columns" top -b -n "$linux_top_sample_frames" -d "$linux_cpu_sample_seconds" >"$1" 2>/dev/null &&
    grep -q '^ *PID ' "$1"
}

# Reads the last frame of `top -b`, whose columns differ between top versions. Output: pid, cpu, mem, command.
linux_processes_from_top() {
  awk -v last_frame="$linux_top_sample_frames" '
    function column(name) { return (name in header_column) ? $header_column[name] : "?" }
    /^ *PID / { frame++; for (i = 1; i <= NF; i++) header_column[$i] = i; next }
    frame == last_frame && NF { print column("PID"), column("%CPU"), column("%MEM"), column("COMMAND") }
  ' "$1"
}

linux_cpu_by_pid() {
  awk -v last_frame="$linux_top_sample_frames" '
    /^ *PID / { frame++; for (i = 1; i <= NF; i++) header_column[$i] = i; next }
    frame == last_frame && NF && ("%CPU" in header_column) { print $header_column["PID"] "\t" $header_column["%CPU"] }
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
  awk '
    /^MemTotal:/ { total = $2 }
    /^MemAvailable:/ { available = $2 }
    /^MemFree:/ { free = $2 }
    /^Buffers:/ { buffers = $2 }
    /^Cached:/ { cached = $2 }
    /^SwapTotal:/ { swap_total = $2 }
    /^SwapFree:/ { swap_free = $2 }
    END {
      if (available == "") available = free + buffers + cached
      printf "mem_total_kb=%d\nmem_avail_kb=%d\nswap_total_kb=%d\nswap_used_kb=%d\n", total, available, swap_total, swap_total - swap_free
    }' /proc/meminfo
}

linux_print_disk_counters() {
  awk -v devices="$linux_disk_device_pattern" -v bytes_per_sector="$linux_bytes_per_disk_sector" '
    BEGIN { DEVICE = 3; SECTORS_READ = 6; SECTORS_WRITTEN = 10 }
    $DEVICE ~ devices { sectors_read += $SECTORS_READ; sectors_written += $SECTORS_WRITTEN }
    END { printf "disk_read_bytes=%.0f\ndisk_write_bytes=%.0f\n", sectors_read * bytes_per_sector, sectors_written * bytes_per_sector }
  ' /proc/diskstats 2>/dev/null
}

linux_print_network_counters() {
  awk '
    BEGIN { RECEIVED_BYTES = 1; SENT_BYTES = 9 }
    NR > 2 {
      line = $0; sub(/^ */, "", line)
      split(line, interface_and_counters, ":")
      split(interface_and_counters[2], counters, " ")
      if (interface_and_counters[1] != "lo") { received += counters[RECEIVED_BYTES]; sent += counters[SENT_BYTES] }
    }
    END { printf "net_rx_bytes=%.0f\nnet_tx_bytes=%.0f\n", received, sent }
  ' /proc/net/dev 2>/dev/null
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

# pid, ppid, cpu, rss_kb, name. The CPU of the top sample wins over the lifetime average of ps.
linux_process_parents() {
  ps -eo pid=,ppid=,pcpu=,rss=,comm= 2>/dev/null | awk -F '\t' 'FILENAME == ARGV[1] { sampled_cpu[$1] = $2; next }
    {
      split($0, column, " ")
      name = $0; sub(/^ *[0-9]+ +[0-9]+ +[^ ]+ +[^ ]+ +/, "", name)
      cpu = (column[1] in sampled_cpu) ? sampled_cpu[column[1]] : column[3]
      printf "%s\t%s\t%s\t%s\t%s\n", column[1], column[2], cpu, column[4], name
    }' "$work_dir/cpu_by_pid" -
}

linux_listening_ports() {
  command -v ss >/dev/null 2>&1 || return 0
  ss -ltnpH 2>/dev/null | awk '
    BEGIN { LOCAL_ADDRESS = 4 }
    {
      port = $LOCAL_ADDRESS; sub(/.*:/, "", port)
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
    sleep "$linux_cpu_sample_seconds"
    process_source='ps'
    : >"$top_output"
  fi
  linux_cpu_ticks >"$work_dir/ticks_after"
  linux_print_cpu "$work_dir/ticks_before" "$work_dir/ticks_after"
  awk '{ printf "load=%s %s %s\n", $1, $2, $3 }' /proc/loadavg
  linux_print_memory
  echo "procs=$(find /proc -maxdepth 1 -name '[0-9]*' -type d 2>/dev/null | wc -l | tr -d ' ')"
  print_missing_tools ss git
  print_disk_usage /
  linux_print_disk_counters
  linux_print_network_counters
  print_gpu
  echo "--procs--"
  if [ "$process_source" = top ]; then
    linux_processes_from_top "$top_output" | select_top_processes | linux_name_processes
  else
    ps -eo pid=,pcpu=,pmem=,comm= 2>/dev/null | select_top_processes | linux_name_processes
  fi
  linux_cpu_by_pid "$top_output" >"$work_dir/cpu_by_pid"
  linux_agent_candidates "$work_dir/cpu_by_pid" >"$work_dir/candidates"
  print_agents_and_ports "$work_dir/candidates" linux
}
