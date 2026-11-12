# shellcheck shell=bash
LOCK_ORPHAN_MINUTES=1

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
