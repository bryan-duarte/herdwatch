# Turns probe v2 output into a host record. Input files: the previous record (or /dev/null), then the probe output.
# Variables: label, target, now. The agent pattern comes from ENVIRON["HERDWATCH_AGENT_PATTERN"], so a user regex
# never becomes program text. A byte counter becomes a rate against the previous record, so a rate needs two polls.
BEGIN {
  agent_pattern = ENVIRON["HERDWATCH_AGENT_PATTERN"]
  section = ""
  PERCENT_SCALE = 100
  PROCESS_PID = 1; PROCESS_CPU = 2; PROCESS_MEM = 3; PROCESS_NAME = 4; PROCESS_PATH = 5
  PROCESS_COLUMNS = 5
  AGENT_COLUMNS = 8; AGENT_MIN_COLUMNS = 6
  PORT_NUMBER = 1; PORT_PID = 2; PORT_PROCESS = 3; PORT_AGENT_PID = 4
  PORT_COLUMNS = 4
  split("disk_read disk_write disk_io net_rx net_tx", rate_names, " ")
  split("home os ncpu uptime_seconds cpu_pct cores load procs disk_pct disk_total_kb disk_used_kb gpu_name gpu_pct gpu_mem_used_mib gpu_mem_total_mib", copied_keys, " ")
}

function printable(text) {
  gsub(/[\001-\037\177]/, "?", text)
  return text
}

function percent(used, total) {
  return total > 0 ? int(PERCENT_SCALE * used / total + 0.5) : "?"
}

function store_key_value(line, target_map,   separator) {
  separator = index(line, "=")
  if (separator > 0) target_map[substr(line, 1, separator - 1)] = printable(substr(line, separator + 1))
}

function printable_row(column, count,   position, row) {
  row = printable(column[1])
  for (position = 2; position <= count; position++) row = row "\t" printable(column[position])
  return row
}

FILENAME == ARGV[1] {
  if ($0 ~ /^\[/) past_previous_header = 1
  if (!past_previous_header) store_key_value($0, previous)
  next
}

$0 == "--procs--" { section = "procs"; next }
$0 == "--agents--" { section = "agents"; next }
$0 == "--ports--" { section = "ports"; next }

section == "" { store_key_value($0, probe); next }

section == "procs" {
  if (split($0, column, "\t") < PROCESS_COLUMNS) next
  is_agent = (agent_pattern != "" && (column[PROCESS_NAME] ~ agent_pattern || column[PROCESS_PATH] ~ agent_pattern)) ? 1 : 0
  processes[++process_count] = printable(column[PROCESS_PID]) "\t" printable(column[PROCESS_CPU]) "\t" printable(column[PROCESS_MEM]) \
    "\t" is_agent "\t" printable(column[PROCESS_NAME])
  next
}

section == "agents" {
  if (split($0, column, "\t") < AGENT_MIN_COLUMNS) next
  agents[++agent_count] = printable_row(column, AGENT_COLUMNS)
  next
}

section == "ports" {
  if (split($0, column, "\t") < 1 || column[PORT_NUMBER] !~ /^[0-9]+$/) next
  ports[++port_count] = column[PORT_NUMBER] "\t" printable(column[PORT_PID]) "\t" printable(column[PORT_PROCESS]) "\t" printable(column[PORT_AGENT_PID])
}

function print_counter_and_rate(name,   counter, elapsed, delta, has_previous_counter) {
  counter = name "_bytes"
  if (!(counter in probe)) return
  printf "%s=%s\n", counter, probe[counter]
  elapsed = now - previous["polled_at"]
  delta = probe[counter] - previous[counter]
  has_previous_counter = (counter in previous) && previous["state"] == "ok"
  if (has_previous_counter && elapsed > 0 && delta >= 0) printf "%s_rate=%.0f\n", name, delta / elapsed
}

function print_rows(section_name, rows, count,   row) {
  print "[" section_name "]"
  for (row = 1; row <= count; row++) print rows[row]
}

END {
  memory_used_kb = probe["mem_total_kb"] - probe["mem_avail_kb"]
  printf "label=%s\ntarget=%s\nstate=ok\npolled_at=%s\nupdated_at=%s\nerror=\n", label, target, now, now
  for (i = 1; i in copied_keys; i++) if (copied_keys[i] in probe) printf "%s=%s\n", copied_keys[i], probe[copied_keys[i]]
  printf "mem_total_kb=%s\nmem_used_kb=%d\nmem_pct=%s\n", probe["mem_total_kb"], memory_used_kb, percent(memory_used_kb, probe["mem_total_kb"])
  printf "swap_total_kb=%s\nswap_used_kb=%s\nswap_pct=%s\n", probe["swap_total_kb"], probe["swap_used_kb"], percent(probe["swap_used_kb"], probe["swap_total_kb"])
  for (i = 1; i in rate_names; i++) print_counter_and_rate(rate_names[i])
  print_rows("procs", processes, process_count)
  print_rows("agents", agents, agent_count)
  print_rows("ports", ports, port_count)
}
