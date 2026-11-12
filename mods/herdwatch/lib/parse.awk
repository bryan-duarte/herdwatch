# Input files: the previous record (or /dev/null), then probe v2 output. Variables: label, target, now.
# Environment: HERDWATCH_AGENT_PATTERN (never put it into the program text). Counters become rates
# against the previous record, so a rate needs two polls.
BEGIN {
  agent_pattern = ENVIRON["HERDWATCH_AGENT_PATTERN"]
  section = ""
  split("disk_read_bytes disk_write_bytes disk_io_bytes net_rx_bytes net_tx_bytes", counter_names, " ")
  split("home os ncpu uptime_seconds cpu_pct cores load procs disk_pct disk_total_kb disk_used_kb gpu_name gpu_pct gpu_mem_used_mib gpu_mem_total_mib", passed_names, " ")
}

function printable(text) {
  gsub(/[\001-\037\177]/, "?", text)
  return text
}

function percent(used, total) {
  return total > 0 ? int(100 * used / total + 0.5) : "?"
}

function key_value(line, target_map,   separator) {
  separator = index(line, "=")
  if (separator > 0) target_map[substr(line, 1, separator - 1)] = printable(substr(line, separator + 1))
}

FILENAME == ARGV[1] {
  if ($0 ~ /^\[/) past_previous_header = 1
  if (!past_previous_header) key_value($0, previous)
  next
}

$0 == "--procs--" { section = "procs"; next }
$0 == "--agents--" { section = "agents"; next }
$0 == "--ports--" { section = "ports"; next }

section == "" { key_value($0, probe); next }

section == "procs" {
  if (split($0, column, "\t") < 5) next
  is_agent = (agent_pattern != "" && (column[4] ~ agent_pattern || column[5] ~ agent_pattern)) ? 1 : 0
  processes[++process_count] = printable(column[1]) "\t" printable(column[2]) "\t" printable(column[3]) "\t" is_agent "\t" printable(column[4])
  next
}

section == "agents" {
  if (split($0, column, "\t") < 6) next
  agents[++agent_count] = printable(column[1]) "\t" printable(column[2]) "\t" printable(column[3]) "\t" printable(column[4]) "\t" \
    printable(column[5]) "\t" printable(column[6]) "\t" printable(column[7]) "\t" printable(column[8])
  next
}

section == "ports" {
  if (split($0, column, "\t") < 1 || column[1] !~ /^[0-9]+$/) next
  ports[++port_count] = column[1] "\t" printable(column[2]) "\t" printable(column[3]) "\t" printable(column[4])
}

function print_rate(name,   counter, elapsed, delta) {
  counter = name "_bytes"
  if (!(counter in probe)) return
  printf "%s=%s\n", counter, probe[counter]
  elapsed = now - previous["polled_at"]
  delta = probe[counter] - previous[counter]
  if ((counter in previous) && previous["state"] == "ok" && elapsed > 0 && delta >= 0) printf "%s_rate=%.0f\n", name, delta / elapsed
}

END {
  memory_used_kb = probe["mem_total_kb"] - probe["mem_avail_kb"]
  printf "label=%s\ntarget=%s\nstate=ok\npolled_at=%s\nupdated_at=%s\nerror=\n", label, target, now, now
  for (i = 1; i in passed_names; i++) if (passed_names[i] in probe) printf "%s=%s\n", passed_names[i], probe[passed_names[i]]
  printf "mem_total_kb=%s\nmem_used_kb=%d\nmem_pct=%s\n", probe["mem_total_kb"], memory_used_kb, percent(memory_used_kb, probe["mem_total_kb"])
  printf "swap_total_kb=%s\nswap_used_kb=%s\nswap_pct=%s\n", probe["swap_total_kb"], probe["swap_used_kb"], percent(probe["swap_used_kb"], probe["swap_total_kb"])
  for (i = 1; i in counter_names; i++) { name = counter_names[i]; sub(/_bytes$/, "", name); print_rate(name) }
  print "[procs]"
  for (row = 1; row <= process_count; row++) print processes[row]
  print "[agents]"
  for (row = 1; row <= agent_count; row++) print agents[row]
  print "[ports]"
  for (row = 1; row <= port_count; row++) print ports[row]
}
