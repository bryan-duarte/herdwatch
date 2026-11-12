# shellcheck shell=bash
SSH_MASTER_PERSIST_SECONDS=120
SSH_SERVER_ALIVE_INTERVAL_SECONDS=5
SSH_SERVER_ALIVE_MAX_MISSES=1
ERROR_MESSAGE_MAX_CHARACTERS=120
WATCHDOG_EXIT_CODE=124
MILLISECONDS_PER_SECOND=1000
# "<state> <reason> <stderr pattern>". The first rule that matches wins, so the order matters.
HERDWATCH_FAILURE_RULES=(
  'auth hostkey REMOTE HOST IDENTIFICATION HAS CHANGED|host key verification failed'
  'auth tailscale_check tailscale'
  'auth login permission denied|too many authentication failures'
  'down dns could not resolve hostname|name or service not known|nodename nor servname'
  'down refused connection refused'
  'down unreachable no route to host|network is unreachable|host is down'
  'down timeout timed out'
  'down ssh_config bad configuration option|terminating, [0-9]+ bad configuration'
  'down remote_shell sh: command not found|sh: not found|account is currently not available'
)

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
  kill -TERM "$2" 2>/dev/null && : >"$3"
}

herdwatch_sanitized_stderr() {
  LC_ALL=C tr -cd '[:print:]\n' <"$1" | grep -v '^$'
}

herdwatch_failure_rule_line() {
  local stderr_file="$1" rule state reason pattern
  for rule in "${HERDWATCH_FAILURE_RULES[@]}"; do
    read -r state reason pattern <<<"$rule"
    if grep -Eiq -- "$pattern" "$stderr_file" 2>/dev/null; then
      printf '%s %s %s\n' "$state" "$reason" "$pattern"
      return 0
    fi
  done
  return 1
}

# Prints "<state> <reason>", e.g. "down timeout" or "auth hostkey".
herdwatch_failure_reason() {
  local stderr_file="$1" exit_code="$2" output_file="$3" rule_line state reason _pattern
  if [ "$exit_code" = "$WATCHDOG_EXIT_CODE" ]; then
    echo "down timeout"
    return
  fi
  if rule_line=$(herdwatch_failure_rule_line "$stderr_file"); then
    read -r state reason _pattern <<<"$rule_line"
    echo "$state $reason"
    return
  fi
  if [ "$exit_code" = 0 ] && [ -s "$output_file" ]; then
    echo "down probe_format"
    return
  fi
  echo "down unknown"
}

herdwatch_failure_detail() {
  local stderr_file="$1" rule_line _state _reason pattern detail=""
  if rule_line=$(herdwatch_failure_rule_line "$stderr_file"); then
    read -r _state _reason pattern <<<"$rule_line"
    detail=$(herdwatch_sanitized_stderr "$stderr_file" | grep -Ei -- "$pattern" | head -n 1)
  fi
  [ -n "$detail" ] || detail=$(herdwatch_sanitized_stderr "$stderr_file" | tail -n 1)
  printf '%s' "$detail" | cut -c1-"$ERROR_MESSAGE_MAX_CHARACTERS"
}

# Returns WATCHDOG_EXIT_CODE when the watchdog stopped ssh, else the exit code of ssh.
herdwatch_run_remote_script() {
  local target="$1" script_file="$2" remote_command="$3" timeout_seconds="$4" output_file="$5" stderr_file="$6"
  local script_pid watchdog_pid script_exit_code timeout_marker="$stderr_file.timeout"
  rm -f "$timeout_marker"
  ssh "${HERDWATCH_SSH_OPTIONS[@]}" -o ControlMaster=no -- "$target" "$remote_command" \
    <"$script_file" >"$output_file" 2>"$stderr_file" &
  script_pid=$!
  herdwatch_kill_after "$timeout_seconds" "$script_pid" "$timeout_marker" </dev/null >/dev/null 2>&1 &
  watchdog_pid=$!
  wait "$script_pid" 2>/dev/null
  script_exit_code=$?
  kill "$watchdog_pid" 2>/dev/null
  wait "$watchdog_pid" 2>/dev/null
  if [ -e "$timeout_marker" ]; then
    rm -f "$timeout_marker"
    return "$WATCHDOG_EXIT_CODE"
  fi
  return "$script_exit_code"
}

# bash 3.2 and BSD date have no milliseconds, so perl takes the time. Without a running master the time would
# include a full SSH handshake, so the measure needs one.
herdwatch_measure_rtt() {
  local target="$1"
  command -v perl >/dev/null 2>&1 || return 0
  herdwatch_master_is_running "$target" || return 0
  perl -MTime::HiRes=time -e '
    my ($scale, @command) = @ARGV;
    my $start = time;
    exit 1 if system(@command) != 0;
    printf "%d\n", (time - $start) * $scale;
  ' -- "$MILLISECONDS_PER_SECOND" ssh "${HERDWATCH_SSH_OPTIONS[@]}" -o ControlMaster=no -- "$target" true </dev/null 2>/dev/null
}
