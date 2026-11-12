# shellcheck shell=bash
WORKTREES_SECTION="[worktrees]"
WORKTREE_PROBE_FORMAT_LINE="worktrees=1"
WORKTREE_PROBE_ROWS_MARKER="--worktrees--"
WORKTREE_LOCK_MARGIN_SECONDS=30

herdwatch_worktrees_file() {
  printf '%s/hosts/%s.worktrees' "$STATE_DIR" "$1"
}

herdwatch_worktree_rows() {
  sed -n "/^\\$WORKTREES_SECTION\$/,\$p" "$1" | tail -n +2
}

herdwatch_worktrees_measured_at() {
  sed -n 's/^measured_at=//p' "$1" 2>/dev/null | head -n 1
}

herdwatch_worktrees_are_due() {
  local index=0 measured_at worktrees_file now
  now=$(date +%s)
  while [ "$index" -lt "$HOST_COUNT" ]; do
    worktrees_file=$(herdwatch_worktrees_file "${HOST_LABELS[$index]}")
    measured_at=$(herdwatch_worktrees_measured_at "$worktrees_file")
    herdwatch_is_whole_number "$measured_at" || return 0
    [ $((now - measured_at)) -ge "$WORKTREE_INTERVAL" ] && return 0
    index=$((index + 1))
  done
  return 1
}

herdwatch_store_worktrees() {
  local worktrees_file="$1" measured_at="$2" probe_output="$3"
  {
    printf 'state=ok\nmeasured_at=%s\nerror=\n%s\n' "$measured_at" "$WORKTREES_SECTION"
    sed -n "/^$WORKTREE_PROBE_ROWS_MARKER\$/,\$p" "$probe_output" | tail -n +2 | LC_ALL=C tr -cd '[:print:]\t\n'
  } >"$worktrees_file.$$.tmp"
  mv "$worktrees_file.$$.tmp" "$worktrees_file"
}

herdwatch_mark_worktrees_failed() {
  local worktrees_file="$1" measured_at="$2" stderr_file="$3" error_message
  error_message=$(herdwatch_last_error_line "$stderr_file")
  [ -n "$error_message" ] || error_message="no answer in ${WORKTREE_TIMEOUT}s"
  {
    printf 'state=failed\nmeasured_at=%s\nerror=%s\n%s\n' "$measured_at" "$error_message" "$WORKTREES_SECTION"
    if [ -r "$worktrees_file" ]; then
      herdwatch_worktree_rows "$worktrees_file"
    fi
  } >"$worktrees_file.$$.tmp"
  mv "$worktrees_file.$$.tmp" "$worktrees_file"
}

herdwatch_measure_host_worktrees() {
  local label="${HOST_LABELS[$1]}" target="${HOST_TARGETS[$1]}" worktrees_file measured_at
  local probe_output="$RUNTIME_DIR/$label.$$.worktrees.raw" stderr_file="$RUNTIME_DIR/$label.$$.worktrees.err"
  local measurement_succeeded=false
  worktrees_file=$(herdwatch_worktrees_file "$label")
  herdwatch_run_remote_script "$target" "$HERDWATCH_ROOT/lib/worktrees_probe.sh" \
    "sh -s -- $WORKTREE_DEPTH $WORKTREE_ROOTS" "$WORKTREE_TIMEOUT" "$probe_output" "$stderr_file" &&
    grep -qx "$WORKTREE_PROBE_FORMAT_LINE" "$probe_output" && measurement_succeeded=true
  measured_at=$(date +%s)
  if [ "$measurement_succeeded" = true ]; then
    herdwatch_store_worktrees "$worktrees_file" "$measured_at" "$probe_output"
  else
    herdwatch_mark_worktrees_failed "$worktrees_file" "$measured_at" "$stderr_file"
    herdwatch_log worktrees_failed "label=$label"
  fi
  rm -f "$probe_output" "$stderr_file"
}

herdwatch_measure_worktrees() {
  herdwatch_seed_config
  herdwatch_load_settings
  herdwatch_load_hosts
  herdwatch_worktrees_are_due || return 0
  herdwatch_lock worktree-lock $((WORKTREE_TIMEOUT + WORKTREE_LOCK_MARGIN_SECONDS)) || return 0
  herdwatch_set_ssh_options
  local index=0
  while [ "$index" -lt "$HOST_COUNT" ]; do
    herdwatch_measure_host_worktrees "$index" &
    index=$((index + 1))
  done
  wait
  herdwatch_unlock worktree-lock
  return 0
}
