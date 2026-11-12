# shellcheck shell=bash
POLL_LOCK_STALE_SECONDS=30
HERDWATCH_PROBE_PARTS="common agents linux darwin main"
HERDWATCH_PROBE_FORMAT_LINE="probe=3"

herdwatch_assemble_probe() {
  local probe_file="$1" part
  for part in $HERDWATCH_PROBE_PARTS; do
    cat "$HERDWATCH_ROOT/lib/probe/$part.sh" || return 1
  done >"$probe_file"
}

# A host keeps the time of its first failure until a poll succeeds again.
herdwatch_previous_down_since() {
  local record_file="$1" polled_at="$2" previous_state previous_down_since was_already_down=false
  previous_state=$(herdwatch_record_value "$record_file" state)
  previous_down_since=$(herdwatch_record_value "$record_file" down_since)
  case "$previous_state" in down | auth) was_already_down=true ;; esac
  if [ "$was_already_down" = true ] && herdwatch_is_whole_number "$previous_down_since"; then
    echo "$previous_down_since"
  else
    echo "$polled_at"
  fi
}

herdwatch_mark_failed() {
  local label="$1" target="$2" polled_at="$3" failure_state="$4" reason="$5" detail="$6"
  local record_file down_since
  record_file=$(herdwatch_record_file "$label")
  down_since=$(herdwatch_previous_down_since "$record_file" "$polled_at")
  {
    printf 'label=%s\ntarget=%s\nstate=%s\npolled_at=%s\nreason=%s\ndetail=%s\ndown_since=%s\n' \
      "$label" "$target" "$failure_state" "$polled_at" "$reason" "$detail" "$down_since"
    if [ -r "$record_file" ]; then
      grep -Ev '^(label|target|state|polled_at|reason|detail|error|down_since)=' "$record_file"
    fi
  } >"$record_file.$$.tmp"
  mv "$record_file.$$.tmp" "$record_file"
  herdwatch_log host_poll_failed "label=$label state=$failure_state reason=$reason detail=$detail"
}

herdwatch_store_record() {
  local label="$1" target="$2" polled_at="$3" probe_output="$4" rtt_ms="$5" record_file previous_record parse_error
  record_file=$(herdwatch_record_file "$label")
  previous_record="$record_file"
  [ -r "$previous_record" ] || previous_record=/dev/null
  if ! HERDWATCH_AGENT_PATTERN="$AGENT_PATTERN" awk -v label="$label" -v target="$target" -v now="$polled_at" -v rtt_ms="$rtt_ms" \
    -f "$HERDWATCH_ROOT/lib/parse.awk" "$previous_record" "$probe_output" >"$record_file.$$.tmp" 2>"$record_file.$$.err"; then
    parse_error=$(herdwatch_failure_detail "$record_file.$$.err")
    rm -f "$record_file.$$.tmp" "$record_file.$$.err"
    herdwatch_mark_failed "$label" "$target" "$polled_at" down parse_failed "$parse_error"
    return 1
  fi
  rm -f "$record_file.$$.err"
  mv "$record_file.$$.tmp" "$record_file"
}

herdwatch_poll_host() {
  local label="${HOST_LABELS[$1]}" target="${HOST_TARGETS[$1]}" probe_file="$2"
  local probe_output="$RUNTIME_DIR/$label.$$.raw" stderr_file="$RUNTIME_DIR/$label.$$.err"
  local polled_at exit_code=0 probe_succeeded=false failure_state reason rtt_ms
  herdwatch_run_remote_script "$target" "$probe_file" "sh -s -- $TOP_N" "$SSH_TIMEOUT" "$probe_output" "$stderr_file" || exit_code=$?
  [ "$exit_code" = 0 ] && grep -qx "$HERDWATCH_PROBE_FORMAT_LINE" "$probe_output" && probe_succeeded=true
  polled_at=$(date +%s)
  if [ "$probe_succeeded" = true ]; then
    rtt_ms=$(herdwatch_measure_rtt "$target")
    herdwatch_store_record "$label" "$target" "$polled_at" "$probe_output" "$rtt_ms" &&
      herdwatch_alerts_update "$label"
    herdwatch_ensure_master "$label" "$target"
  else
    read -r failure_state reason <<<"$(herdwatch_failure_reason "$stderr_file" "$exit_code" "$probe_output")"
    herdwatch_mark_failed "$label" "$target" "$polled_at" "$failure_state" "$reason" "$(herdwatch_failure_detail "$stderr_file")"
  fi
  rm -f "$probe_output" "$stderr_file"
}

herdwatch_remove_unlisted_records() {
  local record_file label
  for record_file in "$STATE_DIR"/hosts/*.rec; do
    [ -e "$record_file" ] || continue
    label="${record_file##*/}"
    label="${label%.rec}"
    herdwatch_has_label "$label" && continue
    rm -f "$record_file" "$STATE_DIR/alerts/$label" "$(herdwatch_port_alert_file "$label")" \
      "$(herdwatch_worktrees_file "$label")" "$(herdwatch_docker_file "$label")"
  done
}

herdwatch_collect() {
  COLLECTOR_STATE=ran
  COLLECTOR_BUSY_SINCE=""
  if ! herdwatch_lock poll-lock "$POLL_LOCK_STALE_SECONDS"; then
    COLLECTOR_STATE=busy
    COLLECTOR_BUSY_SINCE=$(cat "$STATE_DIR/poll-lock.d/taken_at" 2>/dev/null)
    return 0
  fi
  herdwatch_set_ssh_options
  local probe_file="$RUNTIME_DIR/probe.$$.sh" index=0
  if herdwatch_assemble_probe "$probe_file"; then
    while [ "$index" -lt "$HOST_COUNT" ]; do
      herdwatch_poll_host "$index" "$probe_file" &
      index=$((index + 1))
    done
    wait
  else
    herdwatch_log probe_assembly_failed
  fi
  rm -f "$probe_file"
  herdwatch_remove_unlisted_records
  herdwatch_unlock poll-lock
  return 0
}
