# shellcheck shell=bash
DOCKER_TIMEOUT_SECONDS=60
DOCKER_LOCK_MARGIN_SECONDS=30
DOCKER_FIRST_SECTION="[containers]"

herdwatch_docker_file() {
  printf '%s/hosts/%s.docker' "$STATE_DIR" "$1"
}

herdwatch_docker_is_due() {
  [ "$DOCKER" = on ] || return 1
  local index=0 measured_at now
  now=$(date +%s)
  while [ "$index" -lt "$HOST_COUNT" ]; do
    measured_at=$(herdwatch_record_value "$(herdwatch_docker_file "${HOST_LABELS[$index]}")" measured_at)
    herdwatch_is_whole_number "$measured_at" || return 0
    [ $((now - measured_at)) -ge "$DOCKER_INTERVAL" ] && return 0
    index=$((index + 1))
  done
  return 1
}

herdwatch_docker_rows() {
  sed -n "/^\\$DOCKER_FIRST_SECTION\$/,\$p" "$1" 2>/dev/null
}

herdwatch_store_docker() {
  local docker_file="$1" measured_at="$2" probe_output="$3" docker_state probe_error
  docker_state=$(sed -n 's/^docker=//p' "$probe_output" | head -n 1)
  probe_error=$(sed -n 's/^error=//p' "$probe_output" | head -n 1 | LC_ALL=C tr -cd '[:print:]')
  case "$docker_state" in
    1) docker_state=ok ;;
    missing | denied) ;;
    *) docker_state=failed ;;
  esac
  {
    printf 'state=%s\nmeasured_at=%s\nreason=\nerror=%s\n' "$docker_state" "$measured_at" "$probe_error"
    grep -E '^(total_kb|reclaimable_kb)=[0-9]+$' "$probe_output"
    sed -n '/^--containers--$/,$p' "$probe_output" | sed 's/^--\([a-z]*\)--$/[\1]/' | LC_ALL=C tr -cd '[:print:]\t\n'
  } >"$docker_file.$$.tmp"
  mv "$docker_file.$$.tmp" "$docker_file"
}

herdwatch_mark_docker_failed() {
  local docker_file="$1" measured_at="$2" reason="$3" detail="$4"
  {
    printf 'state=failed\nmeasured_at=%s\nreason=%s\nerror=%s\n' "$measured_at" "$reason" "$detail"
    grep -E '^(total_kb|reclaimable_kb)=' "$docker_file" 2>/dev/null
    herdwatch_docker_rows "$docker_file"
  } >"$docker_file.$$.tmp"
  mv "$docker_file.$$.tmp" "$docker_file"
}

herdwatch_measure_host_docker() {
  local label="${HOST_LABELS[$1]}" target="${HOST_TARGETS[$1]}" docker_file measured_at
  local probe_output="$RUNTIME_DIR/$label.$$.docker.raw" stderr_file="$RUNTIME_DIR/$label.$$.docker.err"
  local exit_code=0 _failure_state reason
  docker_file=$(herdwatch_docker_file "$label")
  herdwatch_run_remote_script "$target" "$HERDWATCH_ROOT/lib/docker_probe.sh" "sh -s" "$DOCKER_TIMEOUT_SECONDS" \
    "$probe_output" "$stderr_file" || exit_code=$?
  measured_at=$(date +%s)
  if [ "$exit_code" = 0 ] && grep -q '^docker=' "$probe_output"; then
    herdwatch_store_docker "$docker_file" "$measured_at" "$probe_output"
  else
    read -r _failure_state reason <<<"$(herdwatch_failure_reason "$stderr_file" "$exit_code" "$probe_output")"
    herdwatch_mark_docker_failed "$docker_file" "$measured_at" "$reason" "$(herdwatch_failure_detail "$stderr_file")"
    herdwatch_log docker_failed "label=$label reason=$reason"
  fi
  rm -f "$probe_output" "$stderr_file"
}

herdwatch_measure_docker() {
  herdwatch_seed_config
  herdwatch_load_settings
  herdwatch_load_hosts
  herdwatch_docker_is_due || return 0
  herdwatch_lock docker-lock $((DOCKER_TIMEOUT_SECONDS + DOCKER_LOCK_MARGIN_SECONDS)) || return 0
  herdwatch_set_ssh_options
  local index=0
  while [ "$index" -lt "$HOST_COUNT" ]; do
    herdwatch_measure_host_docker "$index" &
    index=$((index + 1))
  done
  wait
  herdwatch_unlock docker-lock
  return 0
}
