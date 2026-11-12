# shellcheck shell=bash
SNAPSHOT_FORMAT_VERSION=2

herdwatch_json_string() {
  HERDWATCH_JSON_TEXT="$1" awk 'BEGIN { text = ENVIRON["HERDWATCH_JSON_TEXT"]; gsub(/\\/, "\\\\", text); gsub(/"/, "\\\"", text); printf "\"%s\"", text }'
}

herdwatch_worktrees_sorted_by_size() {
  local worktrees_file="$1" tab
  tab=$(printf '\t')
  [ -r "$worktrees_file" ] || return 0
  sed -n "1,/^\\$WORKTREES_SECTION\$/p" "$worktrees_file"
  herdwatch_worktree_rows "$worktrees_file" | sort -t "$tab" -k1,1 -rn
}

herdwatch_print_host_json() {
  local label="$1" target="$2" record_file host_json
  record_file=$(herdwatch_record_file "$label")
  [ -r "$record_file" ] || record_file=/dev/null
  host_json=$(awk -v mode=host -v label="$label" -v target="$target" -f "$HERDWATCH_ROOT/lib/snapshot.awk" "$record_file")
  printf '%s,"worktrees":' "${host_json%\}}"
  herdwatch_worktrees_sorted_by_size "$(herdwatch_worktrees_file "$label")" |
    awk -v mode=worktrees -f "$HERDWATCH_ROOT/lib/snapshot.awk"
  printf '}'
}

herdwatch_print_alerts_json() {
  local outbox taken_outbox
  outbox=$(herdwatch_alert_outbox)
  taken_outbox="$outbox.$$"
  mv "$outbox" "$taken_outbox" 2>/dev/null || : >"$taken_outbox"
  awk -v mode=alerts -f "$HERDWATCH_ROOT/lib/snapshot.awk" "$taken_outbox"
  rm -f "$taken_outbox"
}

herdwatch_print_settings_json() {
  printf '{"warn":%s,"crit":%s,"top_n":%s,"ssh_timeout":%s,"pane_refresh":%s,"stale_seconds":%s,"worktree_interval":%s,"worktree_timeout":%s,"alerts":%s}' \
    "$WARN" "$CRIT" "$TOP_N" "$SSH_TIMEOUT" "$PANE_REFRESH" "$STALE_SECONDS" "$WORKTREE_INTERVAL" "$WORKTREE_TIMEOUT" \
    "$([ "$ALERTS" = on ] && echo true || echo false)"
}

herdwatch_print_snapshot() {
  local index=0 separator=""
  printf '{"version":%s,"generated_at":%s,"hosts_file":%s,"settings_file":%s,"settings":' \
    "$SNAPSHOT_FORMAT_VERSION" "$(date +%s)" \
    "$(herdwatch_json_string "$CONFIG_DIR/hosts.conf")" "$(herdwatch_json_string "$CONFIG_DIR/settings.conf")"
  herdwatch_print_settings_json
  printf ',"hosts":['
  while [ "$index" -lt "$HOST_COUNT" ]; do
    printf '%s' "$separator"
    herdwatch_print_host_json "${HOST_LABELS[$index]}" "${HOST_TARGETS[$index]}"
    separator=","
    index=$((index + 1))
  done
  printf '],"worktrees_due":%s,"alerts":' "$(herdwatch_worktrees_are_due && echo true || echo false)"
  herdwatch_print_alerts_json
  printf '}\n'
}

herdwatch_snapshot() {
  herdwatch_seed_config
  herdwatch_load_settings
  herdwatch_load_hosts
  herdwatch_collect
  herdwatch_print_snapshot
}
