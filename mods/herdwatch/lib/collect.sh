# shellcheck shell=bash
POLL_LOCK_STALE_SECONDS=30
HERDWATCH_PROBE_PARTS="common agents linux darwin main"
HERDWATCH_PROBE_FORMAT_LINE="probe=2"

herdwatch_assemble_probe() {
  local probe_file="$1" part
  for part in $HERDWATCH_PROBE_PARTS; do
    cat "$HERDWATCH_ROOT/lib/probe/$part.sh" || return 1
  done >"$probe_file"
}

herdwatch_mark_failed() {
  local label="$1" target="$2" polled_at="$3" failure_state="$4" stderr_file="$5"
  local record_file error_message
  record_file=$(herdwatch_record_file "$label")
  error_message=$(herdwatch_last_error_line "$stderr_file")
  [ -n "$error_message" ] || error_message="no answer in ${SSH_TIMEOUT}s"
  {
    printf 'label=%s\ntarget=%s\nstate=%s\npolled_at=%s\nerror=%s\n' \
      "$label" "$target" "$failure_state" "$polled_at" "$error_message"
    if [ -r "$record_file" ]; then
      grep -Ev '^(label|target|state|polled_at|error)=' "$record_file"
    fi
  } >"$record_file.$$.tmp"
  mv "$record_file.$$.tmp" "$record_file"
  herdwatch_log host_poll_failed "label=$label state=$failure_state"
}

herdwatch_store_record() {
  local label="$1" target="$2" polled_at="$3" probe_output="$4" record_file previous_record
  record_file=$(herdwatch_record_file "$label")
  previous_record="$record_file"
  [ -r "$previous_record" ] || previous_record=/dev/null
  if ! HERDWATCH_AGENT_PATTERN="$AGENT_PATTERN" awk -v label="$label" -v target="$target" -v now="$polled_at" \
    -f "$HERDWATCH_ROOT/lib/parse.awk" "$previous_record" "$probe_output" >"$record_file.$$.tmp" 2>/dev/null; then
    rm -f "$record_file.$$.tmp"
    herdwatch_log record_parse_failed "label=$label"
    return 1
  fi
  mv "$record_file.$$.tmp" "$record_file"
}

herdwatch_poll_host() {
  local label="${HOST_LABELS[$1]}" target="${HOST_TARGETS[$1]}" probe_file="$2"
  local probe_output="$RUNTIME_DIR/$label.$$.raw" stderr_file="$RUNTIME_DIR/$label.$$.err"
  local polled_at probe_succeeded=false
  herdwatch_run_remote_script "$target" "$probe_file" "sh -s -- $TOP_N" "$SSH_TIMEOUT" \
    "$probe_output" "$stderr_file" &&
    grep -qx "$HERDWATCH_PROBE_FORMAT_LINE" "$probe_output" && probe_succeeded=true
  polled_at=$(date +%s)
  if [ "$probe_succeeded" = true ]; then
    herdwatch_store_record "$label" "$target" "$polled_at" "$probe_output" &&
      herdwatch_alerts_update "$label"
    herdwatch_ensure_master "$label" "$target"
  else
    herdwatch_mark_failed "$label" "$target" "$polled_at" "$(herdwatch_failure_state "$stderr_file")" "$stderr_file"
  fi
  rm -f "$probe_output" "$stderr_file"
}

herdwatch_remove_unlisted_records() {
  local record_file label
  for record_file in "$STATE_DIR"/hosts/*.rec; do
    [ -e "$record_file" ] || continue
    label="${record_file##*/}"
    label="${label%.rec}"
    herdwatch_has_label "$label" || rm -f "$record_file" "$STATE_DIR/alerts/$label" "$(herdwatch_worktrees_file "$label")"
  done
}

herdwatch_collect() {
  herdwatch_lock poll-lock "$POLL_LOCK_STALE_SECONDS" || return 0
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
