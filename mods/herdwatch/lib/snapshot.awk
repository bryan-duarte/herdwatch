# Prints JSON for the Herdr.app mod. Variables: mode ("host", "worktrees", "docker", "alerts" or "problems").
# "host": label, target and pins (the pinned ports of the host, space-separated); input: a record file, or /dev/null
# when the host has no record yet. "worktrees": a worktrees file with its rows sorted by size. "docker": a docker
# file, and docker_setting ("on" or "off"). "alerts": the alert outbox. "problems": the config problem rows.
BEGIN {
  section = ""
  # Each row format is a list of name:type fields, in column order. Types: s string, n number, b "1" is true.
  ALERT_FIELDS = "kind:s label:s cpu_pct:n mem_pct:n top_process:s port:n"
  PROBLEM_FIELDS = "file:s line:n key:s value:s reason:s"
  WORKTREE_FIELDS = "size_kb:n tool:s repository:s branch:s path:s changed_files:n ahead:n behind:n last_commit_at:n absolute_path:s created_at:n last_activity_at:n merged_into:s common_dir:s default_branch:s"
  PROCESS_FIELDS = "pid:n cpu:n mem:n agent:b name:s"
  AGENT_FIELDS = "pid:n app:s elapsed_seconds:n cpu:n mem:n cwd:s branch:s repository:s tree_cpu:n tree_rss_kb:n tree_count:n tree_names:s"
  PORT_FIELDS = "port:n pid:n process:s agent_pid:n pinned:b listening:b"
  CONTAINER_FIELDS = "id:s name:s image:s state:s created_at:n size_kb:n"
  IMAGE_FIELDS = "id:s repository:s tag:s size_kb:n is_dangling:b"
  VOLUME_FIELDS = "name:s size_kb:n is_unused:b"
  HOST_NUMBER_KEYS = "polled_at updated_at down_since rtt_ms ncpu uptime_seconds cpu_pct mem_total_kb mem_used_kb mem_pct swap_total_kb swap_used_kb swap_pct procs disk_pct disk_total_kb disk_used_kb disk_read_rate disk_write_rate disk_io_rate net_rx_rate net_tx_rate"
  PORT_TOOLS = " ss lsof "
  ALERT_MIN_COLUMNS = 2
  PROBLEM_MIN_COLUMNS = 5
  WORKTREE_MIN_COLUMNS = 5
  PROCESS_MIN_COLUMNS = 5
  AGENT_MIN_COLUMNS = 6
  DOCKER_MIN_COLUMNS = 2
  WORKTREE_SIZE_KB = 1
  PORT_NUMBER = 1
  PORT_PINNED = 5
  PORT_LISTENING = 6
  pinned_count = split(pins, pinned_ports, " ")
  for (position = 1; position <= pinned_count; position++) is_pinned[pinned_ports[position]] = 1
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

mode == "problems" {
  if (split($0, column, "\t") < PROBLEM_MIN_COLUMNS) next
  problem_count++
  problems = append(problems, row_json(PROBLEM_FIELDS, column), problem_count)
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
  column[PORT_PINNED] = (column[PORT_NUMBER] in is_pinned) ? "1" : "0"
  column[PORT_LISTENING] = "1"
  listening[column[PORT_NUMBER]] = 1
  port_count++
  ports = append(ports, row_json(PORT_FIELDS, column), port_count)
  next
}

section == "containers" || section == "images" || section == "volumes" {
  if (split($0, column, "\t") < DOCKER_MIN_COLUMNS) next
  docker_count[section]++
  docker_fields = section == "containers" ? CONTAINER_FIELDS : section == "images" ? IMAGE_FIELDS : VOLUME_FIELDS
  docker_rows[section] = append(docker_rows[section], row_json(docker_fields, column), docker_count[section])
}

function gpu_json() {
  if (!("gpu_name" in record)) return "null"
  return "{\"name\":" json_string(record["gpu_name"]) ",\"pct\":" json_number(record["gpu_pct"]) \
    ",\"mem_used_mib\":" json_number(record["gpu_mem_used_mib"]) ",\"mem_total_mib\":" json_number(record["gpu_mem_total_mib"]) "}"
}

function record_state() {
  return ("state" in record) ? record["state"] : "pending"
}

function problem_json(reason, detail) {
  return "{\"reason\":" json_string(reason) ",\"detail\":" json_string(detail) "}"
}

function joined(list, item, separator) {
  return list == "" ? item : list separator item
}

function is_port_tool(tool) {
  return (index(PORT_TOOLS, " " tool " ") > 0)
}

function host_problems_json(   tools, tool_count, position, other_tools, problems_list) {
  if (record["os"] == "unsupported") problems_list = problem_json("unsupported_os", "")
  tool_count = split(record["missing_tools"], tools, " ")
  for (position = 1; position <= tool_count; position++) {
    if (is_port_tool(tools[position])) problems_list = joined(problems_list, problem_json("ports_hidden", tools[position]), ",")
    else other_tools = joined(other_tools, tools[position], " ")
  }
  if (other_tools != "") problems_list = joined(problems_list, problem_json("missing_tools", other_tools), ",")
  return "[" problems_list "]"
}

# Without ss or lsof the host lists no ports at all, so no pinned port can count as stopped.
function ports_are_hidden(   tools, tool_count, position) {
  tool_count = split(record["missing_tools"], tools, " ")
  for (position = 1; position <= tool_count; position++) if (is_port_tool(tools[position])) return 1
  return 0
}

function append_pinned_ports_that_stopped(   position, port, column) {
  if (record_state() != "ok" || ports_are_hidden()) return
  for (position = 1; position <= pinned_count; position++) {
    port = pinned_ports[position]
    if (port in listening) continue
    split("", column)
    column[PORT_NUMBER] = port
    column[PORT_PINNED] = "1"
    column[PORT_LISTENING] = "0"
    port_count++
    ports = append(ports, row_json(PORT_FIELDS, column), port_count)
  }
}

function print_list(rows) {
  printf "[%s]", rows
}

function print_host(   key_list, key_count, position) {
  append_pinned_ports_that_stopped()
  printf "{\"label\":%s,\"target\":%s,\"state\":%s,\"reason\":%s,\"detail\":%s,\"os\":%s,\"load\":%s,\"home\":%s", \
    json_string(label), json_string(target), json_string(record_state()), json_string(record["reason"]), \
    json_string(record["detail"]), json_string(record["os"]), json_string(record["load"]), json_string(record["home"])
  key_count = split(HOST_NUMBER_KEYS, key_list, " ")
  for (position = 1; position <= key_count; position++) printf ",\"%s\":%s", key_list[position], json_number(record[key_list[position]])
  printf ",\"cores\":%s,\"gpu\":%s,\"problems\":%s", json_number_list(record["cores"]), gpu_json(), host_problems_json()
  printf ",\"processes\":[%s],\"agents\":[%s],\"ports\":[%s]}", processes, agents, ports
}

function print_worktrees() {
  printf "{\"state\":%s,\"measured_at\":%s,\"reason\":%s,\"error\":%s,\"total_kb\":%d,\"items\":[%s]}", \
    json_string(record_state()), json_number(record["measured_at"]), json_string(record["reason"]), \
    json_string(record["error"]), worktree_total_kb, worktrees
}

function print_docker(   docker_state) {
  docker_state = docker_setting == "off" ? "off" : record_state()
  printf "{\"state\":%s,\"measured_at\":%s,\"reason\":%s,\"error\":%s,\"total_kb\":%d,\"reclaimable_kb\":%d", \
    json_string(docker_state), json_number(record["measured_at"]), json_string(record["reason"]), \
    json_string(record["error"]), record["total_kb"], record["reclaimable_kb"]
  printf ",\"containers\":[%s],\"images\":[%s],\"volumes\":[%s]}", docker_rows["containers"], docker_rows["images"], docker_rows["volumes"]
}

END {
  if (mode == "alerts") print_list(alerts)
  else if (mode == "problems") print_list(problems)
  else if (mode == "worktrees") print_worktrees()
  else if (mode == "docker") print_docker()
  else print_host()
}
