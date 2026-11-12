POLL_LOCK_STALE_SECONDS=30
LOCK_ORPHAN_MINUTES=1
SSH_MASTER_PERSIST_SECONDS=120
SSH_SERVER_ALIVE_INTERVAL_SECONDS=5
ERROR_MESSAGE_MAX_CHARACTERS=120

herdwatch_set_ssh_options() {
  HERDWATCH_SSH_OPTIONS=(
    -o BatchMode=yes
    -o ConnectTimeout="$SSH_TIMEOUT"
    -o ServerAliveInterval="$SSH_SERVER_ALIVE_INTERVAL_SECONDS"
    -o ServerAliveCountMax=1
    -o ControlPath="$RUNTIME_DIR/%C"
  )
}

herdwatch_lock_is_stale() {
  local lock_dir="$1" stale_seconds="$2" holder_pid taken_at
  holder_pid=$(cat "$lock_dir/pid" 2>/dev/null)
  taken_at=$(cat "$lock_dir/taken_at" 2>/dev/null)
  if [ -z "$holder_pid" ] || [ -z "$taken_at" ]; then
    [ -n "$(find "$lock_dir" -maxdepth 0 -mmin +"$LOCK_ORPHAN_MINUTES" 2>/dev/null)" ]
    return
  fi
  local holder_is_gone=false lock_is_old=false
  kill -0 "$holder_pid" 2>/dev/null || holder_is_gone=true
  [ $(($(date +%s) - taken_at)) -gt "$stale_seconds" ] && lock_is_old=true
  [ "$holder_is_gone" = true ] || [ "$lock_is_old" = true ]
}

herdwatch_lock() {
  local lock_dir="$STATE_DIR/$1.d" stale_seconds="$2" stale_lock_dir="$STATE_DIR/$1.d.stale.$$"
  if ! mkdir "$lock_dir" 2>/dev/null; then
    herdwatch_lock_is_stale "$lock_dir" "$stale_seconds" || return 1
    mv "$lock_dir" "$stale_lock_dir" 2>/dev/null || return 1
    rm -rf "$stale_lock_dir"
    mkdir "$lock_dir" 2>/dev/null || return 1
  fi
  echo "$$" >"$lock_dir/pid"
  date +%s >"$lock_dir/taken_at"
}

herdwatch_unlock() {
  local lock_dir="$STATE_DIR/$1.d" holder_pid
  holder_pid=$(cat "$lock_dir/pid" 2>/dev/null)
  [ "$holder_pid" = "$$" ] && rm -rf "$lock_dir"
}

herdwatch_control_path() {
  ssh "${HERDWATCH_SSH_OPTIONS[@]}" -G -- "$1" 2>/dev/null | awk '$1 == "controlpath" { print $2; exit }'
}

herdwatch_master_is_running() {
  ssh "${HERDWATCH_SSH_OPTIONS[@]}" -O check -- "$1" >/dev/null 2>&1
}

herdwatch_master_start_is_pending() {
  local pending_pid
  pending_pid=$(cat "$1" 2>/dev/null)
  [ -n "$pending_pid" ] && kill -0 "$pending_pid" 2>/dev/null
}

herdwatch_start_master() {
  local target="$1" pending_file="$2"
  (
    set -m # the poller's process group can be killed when a poll ends; the master needs its own.
    ssh "${HERDWATCH_SSH_OPTIONS[@]}" -o ControlMaster=yes -o ControlPersist="$SSH_MASTER_PERSIST_SECONDS" \
      -fN -- "$target" </dev/null >/dev/null 2>&1 &
    echo "$!" >"$pending_file"
  )
}

herdwatch_ensure_master() {
  local label="$1" target="$2" control_path pending_file
  control_path=$(herdwatch_control_path "$target")
  [ -n "$control_path" ] || return 0
  pending_file="$control_path.master-pending"
  if herdwatch_master_is_running "$target"; then
    rm -f "$pending_file"
    return 0
  fi
  herdwatch_master_start_is_pending "$pending_file" && return 0
  rm -f "$control_path"
  herdwatch_start_master "$target" "$pending_file"
  herdwatch_log ssh_master_started "label=$label"
}

herdwatch_kill_after() {
  sleep "$1"
  kill -TERM "$2" 2>/dev/null
}

herdwatch_failure_state() {
  if grep -Eiq 'permission denied|host key verification|tailscale' "$1"; then
    echo auth
  else
    echo down
  fi
}

herdwatch_last_error_line() {
  LC_ALL=C tr -cd '[:print:]\n' <"$1" | grep -v '^$' | tail -n 1 | cut -c1-"$ERROR_MESSAGE_MAX_CHARACTERS"
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

herdwatch_run_remote_script() {
  local target="$1" script_file="$2" remote_command="$3" timeout_seconds="$4" output_file="$5" stderr_file="$6"
  local probe_pid watchdog_pid probe_exit_code
  ssh "${HERDWATCH_SSH_OPTIONS[@]}" -o ControlMaster=no -- "$target" "$remote_command" \
    <"$script_file" >"$output_file" 2>"$stderr_file" &
  probe_pid=$!
  herdwatch_kill_after "$timeout_seconds" "$probe_pid" </dev/null >/dev/null 2>&1 &
  watchdog_pid=$!
  wait "$probe_pid" 2>/dev/null
  probe_exit_code=$?
  kill "$watchdog_pid" 2>/dev/null
  wait "$watchdog_pid" 2>/dev/null
  return "$probe_exit_code"
}

herdwatch_poll_host() {
  local label="${HOST_LABELS[$1]}" target="${HOST_TARGETS[$1]}"
  local probe_output="$RUNTIME_DIR/$label.$$.raw" stderr_file="$RUNTIME_DIR/$label.$$.err"
  local polled_at probe_succeeded=false
  herdwatch_run_remote_script "$target" "$HERDWATCH_ROOT/lib/probe.sh" "sh -s -- $TOP_N" "$SSH_TIMEOUT" \
    "$probe_output" "$stderr_file" &&
    grep -q '^probe=2$' "$probe_output" && probe_succeeded=true
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
  local index=0
  while [ "$index" -lt "$HOST_COUNT" ]; do
    herdwatch_poll_host "$index" &
    index=$((index + 1))
  done
  wait
  herdwatch_remove_unlisted_records
  herdwatch_unlock poll-lock
  return 0
}
