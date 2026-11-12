# shellcheck shell=sh
# herdwatch probe v3. The collector joins lib/probe/{common,agents,linux,darwin,main}.sh in this order and sends
# them over ssh stdin: sh -s -- <top_n>. The output is key=value lines, then the tab-separated sections
# --procs-- (pid, cpu, mem, name, path), --agents-- (pid, app, elapsed, cpu, mem, cwd, branch, repository,
# tree cpu, tree rss kb, tree process count, tree names) and --ports-- (port, pid, process, agent pid).
# lib/parse.awk reads it.
LC_ALL=C
export LC_ALL
default_top_n=30
top_n="${1:-$default_top_n}"
percent_scale=100
bytes_per_kib=1024
kib_per_mib=1024
bytes_per_mib=1048576
max_parent_hops=20
max_tree_names=8
max_tree_names_characters=120
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

print_missing_tools() {
  missing_tools=''
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || missing_tools="$missing_tools $tool"
  done
  echo "missing_tools=${missing_tools# }"
}

print_disk_usage() {
  df -Pk "$1" | awk 'NR == 2 { sub("%", "", $5); printf "disk_pct=%s\ndisk_total_kb=%s\ndisk_used_kb=%s\n", $5, $2, $3 }'
}

print_gpu() {
  command -v nvidia-smi >/dev/null 2>&1 || return 0
  nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -n 1 |
    awk -F', *' 'NF >= 4 { printf "gpu_name=%s\ngpu_pct=%d\ngpu_mem_used_mib=%d\ngpu_mem_total_mib=%d\n", $1, $2, $3, $4 }'
}

print_port_rows() {
  ports_file="$1"
  parents_file="$2"
  agent_pids_file="$3"
  awk -F '\t' -v max_hops="$max_parent_hops" '
    function agent_ancestor(pid,   hop) {
      for (hop = 0; hop < max_hops && pid != "" && pid > 1; hop++) {
        if (pid in is_agent) return pid
        pid = parent_of[pid]
      }
      return ""
    }
    FILENAME == ARGV[1] { parent_of[$1] = $2; next }
    FILENAME == ARGV[2] { is_agent[$1] = 1; next }
    !seen[$1 FS $2]++ { printf "%s\t%s\t%s\t%s\n", $1, $2, $3, agent_ancestor($2) }
  ' "$parents_file" "$agent_pids_file" "$ports_file"
}

# Input: agent rows, then the parent map "pid ppid cpu rss_kb name". Appends tree cpu, tree rss, tree count and
# tree names to each agent row. A process counts for its nearest agent ancestor, so two agents never share one.
print_agent_tree_totals() {
  awk -F '\t' -v max_hops="$max_parent_hops" -v max_names="$max_tree_names" -v max_characters="$max_tree_names_characters" '
    function owning_agent(pid,   hop) {
      for (hop = 0; hop < max_hops && pid != "" && pid > 1; hop++) {
        if (pid in is_agent) return pid
        pid = parent_of[pid]
      }
      return ""
    }
    function busiest_names(agent,   picked, name_count, names, best, member, position) {
      names = ""
      for (name_count = 0; name_count < max_names; name_count++) {
        best = ""
        for (position = 1; position <= member_count[agent]; position++) {
          member = members[agent, position]
          if (!picked[member] && (best == "" || cpu_of[member] > cpu_of[best])) best = member
        }
        if (best == "") break
        picked[best] = 1
        if (index(", " names ", ", ", " name_of[best] ", ")) { name_count--; continue }
        if (length(names) + length(name_of[best]) + 2 > max_characters) break
        names = names (names == "" ? "" : ", ") name_of[best]
      }
      return names
    }
    FILENAME == ARGV[1] { agent_rows[++agent_count] = $0; agent_pid[agent_count] = $1; is_agent[$1] = 1; next }
    { parent_of[$1] = $2; cpu_of[$1] = $3 + 0; rss_of[$1] = $4 + 0; name_of[$1] = $5; process_pids[++process_count] = $1 }
    END {
      for (position = 1; position <= process_count; position++) {
        pid = process_pids[position]
        agent = owning_agent(pid)
        if (agent == "") continue
        tree_cpu[agent] += cpu_of[pid]
        tree_rss[agent] += rss_of[pid]
        members[agent, ++member_count[agent]] = pid
      }
      for (position = 1; position <= agent_count; position++) {
        agent = agent_pid[position]
        printf "%s\t%.1f\t%d\t%d\t%s\n", agent_rows[position], tree_cpu[agent], tree_rss[agent], member_count[agent], busiest_names(agent)
      }
    }' "$1" "$2"
}

# Takes the OS prefix ("linux" or "darwin") whose <os>_process_parents and <os>_listening_ports to use.
print_agents_and_ports() {
  candidates_file="$1"
  os="$2"
  echo "--agents--"
  print_agent_rows "$candidates_file" >"$work_dir/agent_rows"
  cut -f1 "$work_dir/agent_rows" >"$work_dir/agent_pids"
  "${os}_process_parents" >"$work_dir/parents"
  print_agent_tree_totals "$work_dir/agent_rows" "$work_dir/parents"
  "${os}_listening_ports" >"$work_dir/ports"
  echo "--ports--"
  print_port_rows "$work_dir/ports" "$work_dir/parents" "$work_dir/agent_pids"
}
