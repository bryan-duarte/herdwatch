# Prints JSON for the Herdr.app mod. Variables: mode ("host", "worktrees" or "alerts"); for "host": label, target.
# Input for "host": a record file (or /dev/null when the host has no record yet). For "worktrees": a worktrees
# file with its rows sorted by size. For "alerts": the alert outbox.
BEGIN { section = "" }

function json_string(text) {
  gsub(/\\/, "\\\\", text)
  gsub(/"/, "\\\"", text)
  gsub(/[\001-\037\177]/, "?", text)
  return "\"" text "\""
}

function json_number(text) {
  return (text ~ /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/) ? text : "null"
}

function json_number_list(text,   values, count, index_value, output) {
  count = split(text, values, " ")
  output = "["
  for (index_value = 1; index_value <= count; index_value++) output = output (index_value > 1 ? "," : "") json_number(values[index_value])
  return output "]"
}

function append(list, item, count) {
  return count > 1 ? list "," item : item
}

mode == "alerts" {
  if (split($0, column, "\t") < 4) next
  alerts[++alert_count] = "{\"label\":" json_string(column[1]) ",\"cpu_pct\":" json_number(column[2]) \
    ",\"mem_pct\":" json_number(column[3]) ",\"top_process\":" json_string(column[4]) "}"
  next
}

/^\[[a-z]+\]$/ { section = substr($0, 2, length($0) - 2); next }

section == "" {
  separator = index($0, "=")
  if (separator > 0) record[substr($0, 1, separator - 1)] = substr($0, separator + 1)
  next
}

section == "worktrees" {
  if (split($0, column, "\t") < 5) next
  worktree_total_kb += column[1]
  worktree_count++
  worktrees = append(worktrees, "{\"size_kb\":" json_number(column[1]) ",\"tool\":" json_string(column[2]) \
    ",\"repository\":" json_string(column[3]) ",\"branch\":" json_string(column[4]) ",\"path\":" json_string(column[5]) \
    ",\"changed_files\":" json_number(column[6]) ",\"ahead\":" json_number(column[7]) ",\"behind\":" json_number(column[8]) \
    ",\"last_commit_at\":" json_number(column[9]) ",\"absolute_path\":" json_string(column[10]) "}", worktree_count)
  next
}

section == "procs" {
  if (split($0, column, "\t") < 5) next
  process_count++
  processes = append(processes, "{\"pid\":" json_number(column[1]) ",\"cpu\":" json_number(column[2]) \
    ",\"mem\":" json_number(column[3]) ",\"agent\":" (column[4] == "1" ? "true" : "false") ",\"name\":" json_string(column[5]) "}", process_count)
  next
}

section == "agents" {
  if (split($0, column, "\t") < 6) next
  agent_count++
  agents = append(agents, "{\"pid\":" json_number(column[1]) ",\"app\":" json_string(column[2]) ",\"elapsed_seconds\":" json_number(column[3]) \
    ",\"cpu\":" json_number(column[4]) ",\"mem\":" json_number(column[5]) ",\"cwd\":" json_string(column[6]) \
    ",\"branch\":" json_string(column[7]) ",\"repository\":" json_string(column[8]) "}", agent_count)
  next
}

section == "ports" {
  if (split($0, column, "\t") < 1 || column[1] !~ /^[0-9]+$/) next
  port_count++
  ports = append(ports, "{\"port\":" json_number(column[1]) ",\"pid\":" json_number(column[2]) ",\"process\":" json_string(column[3]) \
    ",\"agent_pid\":" json_number(column[4]) "}", port_count)
}

function print_alerts(   row, separator) {
  printf "["
  for (row = 1; row <= alert_count; row++) {
    printf "%s%s", separator, alerts[row]
    separator = ","
  }
  printf "]"
}

function print_gpu() {
  if (!("gpu_name" in record)) return "null"
  return "{\"name\":" json_string(record["gpu_name"]) ",\"pct\":" json_number(record["gpu_pct"]) \
    ",\"mem_used_mib\":" json_number(record["gpu_mem_used_mib"]) ",\"mem_total_mib\":" json_number(record["gpu_mem_total_mib"]) "}"
}

function print_host(   state, key, number_keys, key_count) {
  state = ("state" in record) ? record["state"] : "pending"
  printf "{\"label\":%s,\"target\":%s,\"state\":%s,\"error\":%s,\"os\":%s,\"load\":%s,\"home\":%s", \
    json_string(label), json_string(target), json_string(state), json_string(record["error"]), \
    json_string(record["os"]), json_string(record["load"]), json_string(record["home"])
  key_count = split("polled_at updated_at ncpu uptime_seconds cpu_pct mem_total_kb mem_used_kb mem_pct swap_total_kb swap_used_kb swap_pct procs disk_pct disk_total_kb disk_used_kb disk_read_rate disk_write_rate disk_io_rate net_rx_rate net_tx_rate", number_keys, " ")
  for (key = 1; key <= key_count; key++) printf ",\"%s\":%s", number_keys[key], json_number(record[number_keys[key]])
  printf ",\"cores\":%s,\"gpu\":%s", json_number_list(record["cores"]), print_gpu()
  printf ",\"processes\":[%s],\"agents\":[%s],\"ports\":[%s]}", processes, agents, ports
}

function print_worktrees(   state) {
  state = ("state" in record) ? record["state"] : "pending"
  printf "{\"state\":%s,\"measured_at\":%s,\"error\":%s,\"total_kb\":%d,\"items\":[%s]}", \
    json_string(state), json_number(record["measured_at"]), json_string(record["error"]), worktree_total_kb, worktrees
}

END {
  if (mode == "alerts") print_alerts()
  else if (mode == "worktrees") print_worktrees()
  else print_host()
}
