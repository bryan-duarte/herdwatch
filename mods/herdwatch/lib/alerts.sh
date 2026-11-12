# shellcheck shell=bash
RECORD_PROCESS_NAME_COLUMN=5

herdwatch_top_process_name() {
  herdwatch_record_processes "$1" | awk -F '\t' -v name_column="$RECORD_PROCESS_NAME_COLUMN" 'NR == 1 { print $name_column }'
}

herdwatch_alert_outbox() {
  printf '%s/alert-outbox' "$STATE_DIR"
}

herdwatch_port_alert_file() {
  printf '%s/alerts/ports/%s' "$STATE_DIR" "$1"
}

# Outbox columns: kind, label, cpu, mem, top process, port.
herdwatch_queue_hot_host_alert() {
  local label="$1" record_file="$2"
  printf 'hot\t%s\t%s\t%s\t%s\t\n' "$label" "$record_cpu_pct" "$record_mem_pct" \
    "$(herdwatch_top_process_name "$record_file")" >>"$(herdwatch_alert_outbox)"
  herdwatch_log alert_queued "label=$label cpu=$record_cpu_pct mem=$record_mem_pct"
}

herdwatch_queue_port_down_alert() {
  printf 'port_down\t%s\t\t\t\t%s\n' "$1" "$2" >>"$(herdwatch_alert_outbox)"
  herdwatch_log alert_queued "label=$1 port_down=$2"
}

herdwatch_host_is_hot() {
  herdwatch_is_at_or_above "$record_cpu_pct" "$CRIT" || herdwatch_is_at_or_above "$record_mem_pct" "$CRIT"
}

herdwatch_host_is_calm() {
  ! herdwatch_is_at_or_above "$record_cpu_pct" "$WARN" && ! herdwatch_is_at_or_above "$record_mem_pct" "$WARN"
}

herdwatch_hot_host_alerts_update() {
  local label="$1" alert_file="$STATE_DIR/alerts/$1" record_file="$2"
  local hot_polls=0 already_notified=0
  read -r hot_polls already_notified 2>/dev/null <"$alert_file"
  herdwatch_is_whole_number "$hot_polls" || hot_polls=0
  [ "$already_notified" = 1 ] || already_notified=0
  herdwatch_read_record "$record_file" || return 0
  if herdwatch_host_is_hot; then
    hot_polls=$((hot_polls + 1))
  else
    hot_polls=0
  fi
  herdwatch_host_is_calm && already_notified=0
  if [ "$hot_polls" -ge "$ALERT_POLLS" ] && [ "$already_notified" = 0 ]; then
    herdwatch_queue_hot_host_alert "$label" "$record_file"
    already_notified=1
  fi
  echo "$hot_polls $already_notified" >"$alert_file"
}

# Without ss (Linux) or lsof (macOS) the host lists no ports at all, which is not the same as every port down.
herdwatch_ports_are_hidden() {
  case " $(herdwatch_record_value "$1" missing_tools) " in
    *" ss "* | *" lsof "*) return 0 ;;
    *) return 1 ;;
  esac
}

herdwatch_port_alerts_update() {
  local label="$1" record_file="$2" alert_file pinned_ports port listening_ports previously_down down_ports=""
  alert_file=$(herdwatch_port_alert_file "$label")
  pinned_ports=$(herdwatch_pins_of_label "$label")
  if [ -z "$pinned_ports" ] || herdwatch_ports_are_hidden "$record_file"; then
    rm -f "$alert_file"
    return 0
  fi
  listening_ports=" $(herdwatch_record_section "$record_file" ports | cut -f1 | tr '\n' ' ') "
  previously_down=" $(cat "$alert_file" 2>/dev/null) "
  for port in $pinned_ports; do
    case "$listening_ports" in *" $port "*) continue ;; esac
    down_ports="$down_ports $port"
    case "$previously_down" in *" $port "*) continue ;; esac
    herdwatch_queue_port_down_alert "$label" "$port"
  done
  echo "${down_ports# }" >"$alert_file"
}

herdwatch_alerts_update() {
  [ "$ALERTS" = on ] || return 0
  local record_file
  record_file=$(herdwatch_record_file "$1")
  herdwatch_hot_host_alerts_update "$1" "$record_file"
  herdwatch_port_alerts_update "$1" "$record_file"
}
