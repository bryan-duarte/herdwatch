# shellcheck shell=sh
darwin_data_volume=/System/Volumes/Data

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

darwin_print_cpu() {
  ps -A -o %cpu= | awk -v cores="$1" -v percent_scale="$percent_scale" '
    { summed_percent += $1 }
    END { busy = summed_percent / cores; if (busy > percent_scale) busy = percent_scale; printf "cpu_pct=%d\n", busy }'
}

darwin_print_memory() {
  echo "mem_total_kb=$(($(sysctl -n hw.memsize) / bytes_per_kib))"
  vm_stat | awk -v bytes_per_kib="$bytes_per_kib" '
    /page size of/ { page_size = $8 }
    /^Pages free/ { free = $3 }
    /^Pages inactive/ { inactive = $3 }
    /^Pages speculative/ { speculative = $3 }
    END { printf "mem_avail_kb=%d\n", (free + inactive + speculative) * page_size / bytes_per_kib }'
  sysctl -n vm.swapusage | awk -v kib_per_mib="$kib_per_mib" '
    BEGIN { TOTAL_MIB = 3; USED_MIB = 6 }
    { gsub("M", ""); printf "swap_total_kb=%d\nswap_used_kb=%d\n", $TOTAL_MIB * kib_per_mib, $USED_MIB * kib_per_mib }'
}

darwin_print_disk_counters() {
  iostat -I -d -c 1 2>/dev/null | awk -v bytes_per_mib="$bytes_per_mib" '
    BEGIN { FIRST_MEGABYTES = 3; COLUMNS_PER_DISK = 3 }
    NR == 3 { for (i = FIRST_MEGABYTES; i <= NF; i += COLUMNS_PER_DISK) megabytes += $i }
    END { printf "disk_io_bytes=%.0f\n", megabytes * bytes_per_mib }'
}

# netstat -ibn leaves the address column empty on link rows, so the byte columns shift left by one.
darwin_print_network_counters() {
  netstat -ibn 2>/dev/null | awk '
    BEGIN { COLUMNS_WITH_ADDRESS = 11 }
    $3 ~ /^<Link#/ && $1 !~ /^lo/ && !seen[$1]++ {
      if (NF >= COLUMNS_WITH_ADDRESS) { received += $7; sent += $10 } else { received += $6; sent += $9 }
    }
    END { printf "net_rx_bytes=%.0f\nnet_tx_bytes=%.0f\n", received, sent }'
}

# ps etime is [[dd-]hh:]mm:ss.
darwin_elapsed_seconds() {
  printf '%s\n' "$1" | awk -F '[-:]' '
    BEGIN { split("1 60 3600 86400", seconds_per_unit, " ") }
    { seconds = 0; for (i = 1; i <= NF; i++) seconds += $i * seconds_per_unit[NF - i + 1]; print seconds }'
}

darwin_working_dir() {
  lsof -a -d cwd -p "$1" -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

darwin_interpreter_script() {
  ps -o args= -p "$1" 2>/dev/null | print_script_argument 2
}

# ps comm keeps spaces in the program path, so it is the rest of the line after the five numeric columns.
darwin_possible_agents() {
  ps -A -o pid=,ppid=,etime=,%cpu=,%mem=,comm= 2>/dev/null |
    awk -v agent_pattern="$agent_program_pattern" -v interpreters="$interpreter_pattern" '{
      program_path = $0
      sub(/^ *[0-9]+ +[0-9]+ +[^ ]+ +[^ ]+ +[^ ]+ +/, "", program_path)
      if (program_path ~ agent_pattern || program_path ~ interpreters) printf "%s\t%s\t%s\t%s\t%s\t%s\n", $1, $2, $3, $4, $5, program_path
    }'
}

darwin_agent_candidates() {
  darwin_possible_agents |
    while IFS="$tab" read -r pid ppid elapsed cpu mem program_path; do
      script_path=''
      is_interpreter "$program_path" && script_path=$(darwin_interpreter_script "$pid")
      agent_from_program "$program_path" "${script_path:--}" >/dev/null || continue
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$ppid" "$(darwin_elapsed_seconds "$elapsed")" "$cpu" "$mem" \
        "$program_path" "${script_path:--}" "$(darwin_working_dir "$pid")"
    done
}

darwin_process_parents() {
  ps -A -o pid=,ppid= 2>/dev/null | awk '{ printf "%s\t%s\n", $1, $2 }'
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
  darwin_print_cpu "$cpu_count"
  sysctl -n vm.loadavg | awk '{ printf "load=%s %s %s\n", $2, $3, $4 }'
  darwin_print_memory
  echo "procs=$(ps -A -o pid= | wc -l | tr -d ' ')"
  [ -d "$darwin_data_volume" ] || darwin_data_volume=/
  print_disk_usage "$darwin_data_volume"
  darwin_print_disk_counters
  darwin_print_network_counters
  echo "--procs--"
  ps -A -o pid=,%cpu=,%mem=,args= | select_top_processes | darwin_name_processes
  darwin_agent_candidates >"$work_dir/candidates"
  print_agents_and_ports "$work_dir/candidates" darwin
}
