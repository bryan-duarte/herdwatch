# shellcheck shell=bash
LOG_MAX_BYTES=262144
LOG_BYTES_KEPT_AFTER_TRIM=$((LOG_MAX_BYTES / 2))

herdwatch_resolve_dirs() {
  CONFIG_DIR="${HERDWATCH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/herdwatch}"
  STATE_DIR="${HERDWATCH_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/herdwatch}"
  RUNTIME_DIR="/tmp/herdwatch-$(id -u)"
  mkdir -p "$CONFIG_DIR" "$STATE_DIR/hosts" "$STATE_DIR/alerts/ports" || return 1
  mkdir -m 700 "$RUNTIME_DIR" 2>/dev/null
  herdwatch_secure_runtime_dir || {
    echo "herdwatch: $RUNTIME_DIR belongs to another user or is a symlink" >&2
    return 1
  }
}

herdwatch_secure_runtime_dir() {
  [ -d "$RUNTIME_DIR" ] && [ ! -L "$RUNTIME_DIR" ] && [ -O "$RUNTIME_DIR" ] && chmod 700 "$RUNTIME_DIR"
}

herdwatch_log() {
  local event="$1" log_file="$STATE_DIR/herdwatch.log" log_size
  shift
  printf '%s %s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$event" "$*" >>"$log_file"
  log_size=$(wc -c <"$log_file")
  [ "$log_size" -gt "$LOG_MAX_BYTES" ] || return 0
  tail -c "$LOG_BYTES_KEPT_AFTER_TRIM" "$log_file" >"$log_file.$$.tmp" && mv "$log_file.$$.tmp" "$log_file"
}
