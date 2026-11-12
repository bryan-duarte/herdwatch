# shellcheck shell=bash
WORKTREES_SECTION="[worktrees]"
WORKTREE_PROBE_FORMAT_LINE="worktrees=1"
WORKTREE_PROBE_ROWS_MARKER="--worktrees--"
WORKTREE_LOCK_MARGIN_SECONDS=30
WORKTREE_ABSOLUTE_PATH_COLUMN=10

herdwatch_worktrees_file() {
  printf '%s/hosts/%s.worktrees' "$STATE_DIR" "$1"
}

herdwatch_worktree_rows() {
  sed -n "/^\\$WORKTREES_SECTION\$/,\$p" "$1" | tail -n +2
}

herdwatch_worktrees_are_due() {
  local index=0 measured_at worktrees_file now
  now=$(date +%s)
  while [ "$index" -lt "$HOST_COUNT" ]; do
    worktrees_file=$(herdwatch_worktrees_file "${HOST_LABELS[$index]}")
    measured_at=$(herdwatch_record_value "$worktrees_file" measured_at)
    herdwatch_is_whole_number "$measured_at" || return 0
    [ $((now - measured_at)) -ge "$WORKTREE_INTERVAL" ] && return 0
    index=$((index + 1))
  done
  return 1
}

herdwatch_store_worktrees() {
  local worktrees_file="$1" measured_at="$2" probe_output="$3" missing_roots reason=""
  missing_roots=$(sed -n 's/^missing_roots=//p' "$probe_output" | head -n 1 | LC_ALL=C tr -cd '[:print:]')
  [ -n "$missing_roots" ] && reason=missing_root
  {
    printf 'state=ok\nmeasured_at=%s\nreason=%s\nerror=%s\n%s\n' "$measured_at" "$reason" "$missing_roots" "$WORKTREES_SECTION"
    sed -n "/^$WORKTREE_PROBE_ROWS_MARKER\$/,\$p" "$probe_output" | tail -n +2 | LC_ALL=C tr -cd '[:print:]\t\n'
  } >"$worktrees_file.$$.tmp"
  mv "$worktrees_file.$$.tmp" "$worktrees_file"
}

herdwatch_mark_worktrees_failed() {
  local worktrees_file="$1" measured_at="$2" reason="$3" detail="$4"
  {
    printf 'state=failed\nmeasured_at=%s\nreason=%s\nerror=%s\n%s\n' "$measured_at" "$reason" "$detail" "$WORKTREES_SECTION"
    if [ -r "$worktrees_file" ]; then
      herdwatch_worktree_rows "$worktrees_file"
    fi
  } >"$worktrees_file.$$.tmp"
  mv "$worktrees_file.$$.tmp" "$worktrees_file"
}

herdwatch_measure_host_worktrees() {
  local label="${HOST_LABELS[$1]}" target="${HOST_TARGETS[$1]}" worktrees_file measured_at
  local probe_output="$RUNTIME_DIR/$label.$$.worktrees.raw" stderr_file="$RUNTIME_DIR/$label.$$.worktrees.err"
  local measurement_succeeded=false exit_code=0 _failure_state reason
  worktrees_file=$(herdwatch_worktrees_file "$label")
  herdwatch_run_remote_script "$target" "$HERDWATCH_ROOT/lib/worktrees_probe.sh" \
    "sh -s -- $WORKTREE_DEPTH ${MERGED_BRANCHES// /,} $WORKTREE_ROOTS" "$WORKTREE_TIMEOUT" "$probe_output" "$stderr_file" || exit_code=$?
  [ "$exit_code" = 0 ] && grep -qx "$WORKTREE_PROBE_FORMAT_LINE" "$probe_output" && measurement_succeeded=true
  measured_at=$(date +%s)
  if [ "$measurement_succeeded" = true ]; then
    herdwatch_store_worktrees "$worktrees_file" "$measured_at" "$probe_output"
  else
    read -r _failure_state reason <<<"$(herdwatch_failure_reason "$stderr_file" "$exit_code" "$probe_output")"
    herdwatch_mark_worktrees_failed "$worktrees_file" "$measured_at" "$reason" "$(herdwatch_failure_detail "$stderr_file")"
    herdwatch_log worktrees_failed "label=$label reason=$reason"
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

herdwatch_worktree_row() {
  herdwatch_worktree_rows "$(herdwatch_worktrees_file "$1")" 2>/dev/null |
    awk -F '\t' -v path="$2" -v column="$WORKTREE_ABSOLUTE_PATH_COLUMN" '$column == path { print; exit }'
}

herdwatch_remove_worktree_row() {
  local worktrees_file
  worktrees_file=$(herdwatch_worktrees_file "$1")
  [ -r "$worktrees_file" ] || return 0
  herdwatch_lock worktree-lock $((WORKTREE_TIMEOUT + WORKTREE_LOCK_MARGIN_SECONDS)) || return 0
  awk -F '\t' -v path="$2" -v section="$WORKTREES_SECTION" -v column="$WORKTREE_ABSOLUTE_PATH_COLUMN" '
    $0 == section { in_rows = 1 }
    !(in_rows && $column == path)' "$worktrees_file" >"$worktrees_file.$$.tmp" && mv "$worktrees_file.$$.tmp" "$worktrees_file"
  herdwatch_unlock worktree-lock
}
