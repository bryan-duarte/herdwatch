# Prints JSON for the Herdr.app mod. Variables: mode ("host", "worktrees" or "alerts"); for "host": label, target.
# Input for "host": a record file (or /dev/null when the host has no record yet). For "worktrees": a worktrees
# file with its rows sorted by size. For "alerts": the alert outbox.
BEGIN {
  section = ""
  # Each row format is a list of name:type fields, in column order. Types: s string, n number, b "1" is true.
  ALERT_FIELDS = "label:s cpu_pct:n mem_pct:n top_process:s"
  WORKTREE_FIELDS = "size_kb:n tool:s repository:s branch:s path:s changed_files:n ahead:n behind:n last_commit_at:n absolute_path:s"
  PROCESS_FIELDS = "pid:n cpu:n mem:n agent:b name:s"
  AGENT_FIELDS = "pid:n app:s elapsed_seconds:n cpu:n mem:n cwd:s branch:s repository:s"
  PORT_FIELDS = "port:n pid:n process:s agent_pid:n"
  HOST_NUMBER_KEYS = "polled_at updated_at ncpu uptime_seconds cpu_pct mem_total_kb mem_used_kb mem_pct swap_total_kb swap_used_kb swap_pct procs disk_pct disk_total_kb disk_used_kb disk_read_rate disk_write_rate disk_io_rate net_rx_rate net_tx_rate"
  ALERT_MIN_COLUMNS = 4
  WORKTREE_MIN_COLUMNS = 5
  PROCESS_MIN_COLUMNS = 5
  AGENT_MIN_COLUMNS = 6
  WORKTREE_SIZE_KB = 1
  PORT_NUMBER = 1
}

function json_string(text) {
  gsub(/\\/, "\\\\", text)
  gsub(/"/, "\\\"", text)
  gsub(/[\001-\037\177]/, "?", text)
  return "\"" text "\""
}

function json_number(text) {
  return (text ~ /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/) ? text : "null"
}

function json_bool(text) {
  return text == "1" ? "true" : "false"
}

function json_number_list(text,   numbers, count, position, output) {
  count = split(text, numbers, " ")
  output = "["
  for (position = 1; position <= count; position++) output = output (position > 1 ? "," : "") json_number(numbers[position])
  return output "]"
}

function json_value(type, text) {
  if (type == "n") return json_number(text)
  if (type == "b") return json_bool(text)
  return json_string(text)
}

function row_json(fields, column,   field_list, field_count, position, name_and_type, output) {
  field_count = split(fields, field_list, " ")
  output = "{"
  for (position = 1; position <= field_count; position++) {
    split(field_list[position], name_and_type, ":")
    output = output (position > 1 ? "," : "") "\"" name_and_type[1] "\":" json_value(name_and_type[2], column[position])
  }
  return output "}"
}

function append(list, item, count) {
  return count > 1 ? list "," item : item
}

mode == "alerts" {
  if (split($0, column, "\t") < ALERT_MIN_COLUMNS) next
  alert_count++
  alerts = append(alerts, row_json(ALERT_FIELDS, column), alert_count)
  next
}

/^\[[a-z]+\]$/ { section = substr($0, 2, length($0) - 2); next }

section == "" {
  separator = index($0, "=")
  if (separator > 0) record[substr($0, 1, separator - 1)] = substr($0, separator + 1)
  next
}

section == "worktrees" {
  if (split($0, column, "\t") < WORKTREE_MIN_COLUMNS) next
  worktree_total_kb += column[WORKTREE_SIZE_KB]
  worktree_count++
  worktrees = append(worktrees, row_json(WORKTREE_FIELDS, column), worktree_count)
  next
}

section == "procs" {
  if (split($0, column, "\t") < PROCESS_MIN_COLUMNS) next
  process_count++
  processes = append(processes, row_json(PROCESS_FIELDS, column), process_count)
  next
}

section == "agents" {
  if (split($0, column, "\t") < AGENT_MIN_COLUMNS) next
  agent_count++
  agents = append(agents, row_json(AGENT_FIELDS, column), agent_count)
  next
}

section == "ports" {
  if (split($0, column, "\t") < 1 || column[PORT_NUMBER] !~ /^[0-9]+$/) next
  port_count++
  ports = append(ports, row_json(PORT_FIELDS, column), port_count)
}

function gpu_json() {
  if (!("gpu_name" in record)) return "null"
  return "{\"name\":" json_string(record["gpu_name"]) ",\"pct\":" json_number(record["gpu_pct"]) \
    ",\"mem_used_mib\":" json_number(record["gpu_mem_used_mib"]) ",\"mem_total_mib\":" json_number(record["gpu_mem_total_mib"]) "}"
}

function record_state() {
  return ("state" in record) ? record["state"] : "pending"
}

function print_alerts() {
  printf "[%s]", alerts
}

function print_host(   key_list, key_count, position) {
  printf "{\"label\":%s,\"target\":%s,\"state\":%s,\"error\":%s,\"os\":%s,\"load\":%s,\"home\":%s", \
    json_string(label), json_string(target), json_string(record_state()), json_string(record["error"]), \
    json_string(record["os"]), json_string(record["load"]), json_string(record["home"])
  key_count = split(HOST_NUMBER_KEYS, key_list, " ")
  for (position = 1; position <= key_count; position++) printf ",\"%s\":%s", key_list[position], json_number(record[key_list[position]])
  printf ",\"cores\":%s,\"gpu\":%s", json_number_list(record["cores"]), gpu_json()
  printf ",\"processes\":[%s],\"agents\":[%s],\"ports\":[%s]}", processes, agents, ports
}

function print_worktrees() {
  printf "{\"state\":%s,\"measured_at\":%s,\"error\":%s,\"total_kb\":%d,\"items\":[%s]}", \
    json_string(record_state()), json_number(record["measured_at"]), json_string(record["error"]), worktree_total_kb, worktrees
}

END {
  if (mode == "alerts") print_alerts()
  else if (mode == "worktrees") print_worktrees()
  else print_host()
}
