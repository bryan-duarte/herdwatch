# shellcheck shell=bash
SSH_MASTER_PERSIST_SECONDS=120
SSH_SERVER_ALIVE_INTERVAL_SECONDS=5
SSH_SERVER_ALIVE_MAX_MISSES=1
ERROR_MESSAGE_MAX_CHARACTERS=120
AUTH_FAILURE_PATTERN='permission denied|host key verification|tailscale'

herdwatch_set_ssh_options() {
  HERDWATCH_SSH_OPTIONS=(
    -o BatchMode=yes
    -o ConnectTimeout="$SSH_TIMEOUT"
    -o ServerAliveInterval="$SSH_SERVER_ALIVE_INTERVAL_SECONDS"
    -o ServerAliveCountMax="$SSH_SERVER_ALIVE_MAX_MISSES"
    -o ControlPath="$RUNTIME_DIR/%C"
  )
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
    # The poller's process group can be killed when a poll ends; the master needs its own.
    set -m
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
  if grep -Eiq "$AUTH_FAILURE_PATTERN" "$1"; then
    echo auth
  else
    echo down
  fi
}

herdwatch_last_error_line() {
  LC_ALL=C tr -cd '[:print:]\n' <"$1" | grep -v '^$' | tail -n 1 | cut -c1-"$ERROR_MESSAGE_MAX_CHARACTERS"
}

herdwatch_run_remote_script() {
  local target="$1" script_file="$2" remote_command="$3" timeout_seconds="$4" output_file="$5" stderr_file="$6"
  local script_pid watchdog_pid script_exit_code
  ssh "${HERDWATCH_SSH_OPTIONS[@]}" -o ControlMaster=no -- "$target" "$remote_command" \
    <"$script_file" >"$output_file" 2>"$stderr_file" &
  script_pid=$!
  herdwatch_kill_after "$timeout_seconds" "$script_pid" </dev/null >/dev/null 2>&1 &
  watchdog_pid=$!
  wait "$script_pid" 2>/dev/null
  script_exit_code=$?
  kill "$watchdog_pid" 2>/dev/null
  wait "$watchdog_pid" 2>/dev/null
  return "$script_exit_code"
}
