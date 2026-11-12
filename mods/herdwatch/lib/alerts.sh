# shellcheck shell=bash
RECORD_PROCESS_NAME_COLUMN=5

herdwatch_top_process_name() {
  herdwatch_record_processes "$1" | awk -F '\t' -v name_column="$RECORD_PROCESS_NAME_COLUMN" 'NR == 1 { print $name_column }'
}

herdwatch_alert_outbox() {
  printf '%s/alert-outbox' "$STATE_DIR"
}

herdwatch_queue_hot_host_alert() {
  local label="$1" record_file="$2"
  printf '%s\t%s\t%s\t%s\n' "$label" "$record_cpu_pct" "$record_mem_pct" \
    "$(herdwatch_top_process_name "$record_file")" >>"$(herdwatch_alert_outbox)"
  herdwatch_log alert_queued "label=$label cpu=$record_cpu_pct mem=$record_mem_pct"
}

herdwatch_host_is_hot() {
  herdwatch_is_at_or_above "$record_cpu_pct" "$CRIT" || herdwatch_is_at_or_above "$record_mem_pct" "$CRIT"
}

herdwatch_host_is_calm() {
  ! herdwatch_is_at_or_above "$record_cpu_pct" "$WARN" && ! herdwatch_is_at_or_above "$record_mem_pct" "$WARN"
}

herdwatch_alerts_update() {
  [ "$ALERTS" = on ] || return 0
  local label="$1" alert_file="$STATE_DIR/alerts/$1" record_file
  local hot_polls=0 already_notified=0
  record_file=$(herdwatch_record_file "$label")
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
