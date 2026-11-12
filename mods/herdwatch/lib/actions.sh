# shellcheck shell=bash
# herdwatch action <name> <label> [args...]: one change on one host. Every value from the console is checked against
# hosts.conf or the stored records before any ssh call, then reaches a fixed remote script as a quoted argument.
# The output is one JSON object; handled failures also exit 0.
ACTION_NAMES="pin unpin kill worktree-remove docker-stop docker-rm docker-prune"
ACTION_TIMEOUT_SECONDS=20
ACTION_LOCK_STALE_SECONDS=60
DOCKER_ACTION_TIMEOUT_SECONDS=120
DOCKER_CONTAINER_ID_PATTERN='^[0-9a-f]{12,64}$'
KILL_SIGNAL=TERM
FORCE_KILL_SIGNAL=KILL
RECORD_AGENT_FOLDER_COLUMN=6
WORKTREE_BRANCH_COLUMN=4
DOCKER_CONTAINER_STATE_COLUMN=4

herdwatch_is_action_name() {
  case " $ACTION_NAMES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

herdwatch_action_succeeded() {
  local message="$1" data_json="${2:-}"
  [ -n "$data_json" ] || data_json='{}'
  printf '{"ok":true,"message":%s,"data":%s}\n' "$(herdwatch_json_string "$message")" "$data_json"
}

herdwatch_action_failed() {
  local reason="$1" message="$2" detail="${3:-}"
  printf '{"ok":false,"reason":%s,"message":%s,"detail":%s}\n' \
    "$(herdwatch_json_string "$reason")" "$(herdwatch_json_string "$message")" "$(herdwatch_json_string "$detail")"
  herdwatch_log action_failed "reason=$reason detail=$detail"
}

herdwatch_json_number_list() {
  printf '%s' "$1" | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) list = list (list == "" ? "" : ",") $i } END { printf "[%s]", list }'
}

herdwatch_word_count() {
  echo "$1" | wc -w | tr -d ' '
}

herdwatch_count_text() {
  local count="$1" singular="$2" plural="$3"
  if [ "$count" = 1 ]; then echo "1 $singular"; else echo "$count $plural"; fi
}

herdwatch_shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

herdwatch_action_output_value() {
  herdwatch_record_value "$ACTION_OUTPUT" "$1" | LC_ALL=C tr -cd '[:print:]'
}

herdwatch_action_output_number() {
  local output_number
  output_number=$(herdwatch_action_output_value "$1")
  herdwatch_is_whole_number "$output_number" || output_number=0
  echo "$output_number"
}

# Runs lib/action_scripts/<script>.sh on the host as "sh -s -- <quoted args>"; its key=value lines land in
# ACTION_OUTPUT. When the host does not answer, this prints the failure and returns 1.
herdwatch_run_remote_action() {
  local label="$1" script_name="$2" timeout_seconds="$3"
  shift 3
  local index target remote_command="sh -s --" argument exit_code=0 _failure_state reason
  index=$(herdwatch_host_index "$label")
  target="${HOST_TARGETS[$index]}"
  for argument in "$@"; do
    remote_command="$remote_command $(herdwatch_shell_quote "$argument")"
  done
  herdwatch_set_ssh_options
  herdwatch_run_remote_script "$target" "$HERDWATCH_ROOT/lib/action_scripts/$script_name.sh" "$remote_command" \
    "$timeout_seconds" "$ACTION_OUTPUT" "$ACTION_STDERR" || exit_code=$?
  [ "$exit_code" = 0 ] && grep -q '^result=' "$ACTION_OUTPUT" && return 0
  read -r _failure_state reason <<<"$(herdwatch_failure_reason "$ACTION_STDERR" "$exit_code" "$ACTION_OUTPUT")"
  herdwatch_action_failed host_down "Herdwatch could not reach $label ($reason)." "$(herdwatch_failure_detail "$ACTION_STDERR")"
  return 1
}

herdwatch_take_action_lock() {
  herdwatch_lock "action-$1" "$ACTION_LOCK_STALE_SECONDS" && return 0
  herdwatch_action_failed busy "Another action runs on $1. Try again in a few seconds."
  return 1
}

herdwatch_action_pin() {
  local change="$1" label="$2" port="${3:-}"
  if ! herdwatch_is_port "$port"; then
    herdwatch_action_failed bad_input "The port $port is not a number from 1 to 65535."
    return 0
  fi
  if ! herdwatch_rewrite_pins "$change" "$label" "$port"; then
    herdwatch_action_failed busy "Herdwatch could not write $(herdwatch_pins_file). Try again in a few seconds."
    return 0
  fi
  if [ "$change" = pin ]; then
    herdwatch_action_succeeded "Pinned :$port on $label."
  else
    herdwatch_action_succeeded "Unpinned :$port on $label."
  fi
}

# The pids that lived through TERM, so "Force kill" reaches them also when the root process is already gone.
herdwatch_kill_survivors_file() {
  printf '%s/kill-survivors-%s-%s' "$STATE_DIR" "$1" "$2"
}

herdwatch_remember_kill_survivors() {
  local survivors_file="$1" kill_outcome="$2" alive="$3"
  case "$kill_outcome" in
    ok | gone) rm -f "$survivors_file" ;;
    *) herdwatch_json_number_list "$alive" | tr -d '[]' | tr ',' ' ' >"$survivors_file" ;;
  esac
}

herdwatch_kill_result() {
  local label="$1" pid="$2" killed alive data_json kill_outcome
  killed=$(herdwatch_action_output_value killed)
  alive=$(herdwatch_action_output_value alive)
  kill_outcome=$(herdwatch_action_output_value result)
  data_json="{\"killed\":$(herdwatch_json_number_list "$killed"),\"alive\":$(herdwatch_json_number_list "$alive")}"
  herdwatch_remember_kill_survivors "$(herdwatch_kill_survivors_file "$label" "$pid")" "$kill_outcome" "$alive"
  case "$kill_outcome" in
    ok) herdwatch_action_succeeded "Stopped $(herdwatch_count_text "$(herdwatch_word_count "$killed")" process processes)." "$data_json" ;;
    gone) herdwatch_action_succeeded "Process $pid had already stopped." "$data_json" ;;
    not_owner) herdwatch_action_failed not_owner "You do not own this process. Herdwatch never uses sudo." "alive: $alive" ;;
    *)
      herdwatch_action_failed still_running \
        "$(herdwatch_count_text "$(herdwatch_word_count "$alive")" "process is" "processes are") still running: ${alive// /, }." "$alive"
      ;;
  esac
}

herdwatch_action_kill() {
  local label="$1" pid="${2:-}" signal="$KILL_SIGNAL" survivor_pids=""
  if ! herdwatch_is_positive_integer "$pid" || [ "$pid" -le 1 ]; then
    herdwatch_action_failed bad_input "The pid $pid is not a process that Herdwatch can stop."
    return 0
  fi
  if ! herdwatch_record_has_pid "$label" "$pid"; then
    herdwatch_action_failed bad_input "Process $pid is not in the last poll of $label. Wait for the next poll and try again."
    return 0
  fi
  if [ "${3:-}" = --force ]; then
    signal="$FORCE_KILL_SIGNAL"
    survivor_pids=$(cat "$(herdwatch_kill_survivors_file "$label" "$pid")" 2>/dev/null)
  fi
  herdwatch_take_action_lock "$label" || return 0
  # shellcheck disable=SC2086
  herdwatch_run_remote_action "$label" kill_tree "$ACTION_TIMEOUT_SECONDS" "$pid" "$signal" $survivor_pids &&
    herdwatch_kill_result "$label" "$pid"
  herdwatch_unlock "action-$label"
}

herdwatch_agent_works_in() {
  local record_file
  record_file=$(herdwatch_record_file "$1")
  herdwatch_record_section "$record_file" agents 2>/dev/null | awk -F '\t' -v folder="$2" -v column="$RECORD_AGENT_FOLDER_COLUMN" '
    $column == folder || index($column, folder "/") == 1 { found = 1 }
    END { exit !found }'
}

herdwatch_worktree_remove_result() {
  local label="$1" worktree_dir="$2" branch="$3"
  case "$(herdwatch_action_output_value result)" in
    gone)
      herdwatch_remove_worktree_row "$label" "$worktree_dir"
      herdwatch_action_succeeded "The worktree folder was already gone. Run git worktree prune in the repository to clean up its record."
      ;;
    ok)
      herdwatch_remove_worktree_row "$label" "$worktree_dir"
      if [ -n "$branch" ]; then
        herdwatch_action_succeeded "Removed the worktree and the branch $branch."
      else
        herdwatch_action_succeeded "Removed the worktree."
      fi
      ;;
    branch_not_merged)
      herdwatch_remove_worktree_row "$label" "$worktree_dir"
      herdwatch_action_failed branch_not_merged "Removed the worktree. The branch has commits that are not merged. It was kept." \
        "$(herdwatch_action_output_value error)"
      ;;
    main_checkout) herdwatch_action_failed bad_input "This is the main checkout of the repository. Herdwatch removes linked worktrees only." ;;
    process_inside)
      herdwatch_action_failed agent_inside "Process $(herdwatch_action_output_value pid) works in this worktree. Stop it first." ;;
    dirty)
      herdwatch_action_failed dirty \
        "$(herdwatch_count_text "$(herdwatch_action_output_number changed_files)" "file has" "files have") uncommitted changes. Nothing was removed."
      ;;
    *) herdwatch_action_failed remote_error "Git did not remove the worktree." "$(herdwatch_action_output_value error)" ;;
  esac
}

herdwatch_action_worktree_remove() {
  local label="$1" worktree_dir="${2:-}" force=0 delete_branch=false argument stored_row branch=""
  for argument in "${@:3}"; do
    case "$argument" in
      --force) force=1 ;;
      --delete-branch) delete_branch=true ;;
    esac
  done
  stored_row=$(herdwatch_worktree_row "$label" "$worktree_dir")
  if [ -z "$worktree_dir" ] || [ -z "$stored_row" ]; then
    herdwatch_action_failed bad_input "This worktree is not in the last measure of $label. Wait for the next measure."
    return 0
  fi
  if herdwatch_agent_works_in "$label" "$worktree_dir"; then
    herdwatch_action_failed agent_inside "An agent works in this worktree. Stop it first."
    return 0
  fi
  if [ "$delete_branch" = true ]; then
    branch=$(printf '%s' "$stored_row" | cut -f"$WORKTREE_BRANCH_COLUMN")
    [[ $branch =~ $HERDWATCH_BRANCH_NAME_PATTERN ]] || branch=""
  fi
  herdwatch_take_action_lock "$label" || return 0
  herdwatch_run_remote_action "$label" worktree_remove "$ACTION_TIMEOUT_SECONDS" "$worktree_dir" "$force" "$branch" &&
    herdwatch_worktree_remove_result "$label" "$worktree_dir" "$branch"
  herdwatch_unlock "action-$label"
}

herdwatch_stored_container_state() {
  sed -n '/^\[containers\]$/,/^\[[a-z]*\]$/p' "$(herdwatch_docker_file "$1")" 2>/dev/null |
    awk -F '\t' -v id="$2" -v column="$DOCKER_CONTAINER_STATE_COLUMN" '$1 == id { print $column; exit }'
}

herdwatch_remeasure_docker() {
  local index
  index=$(herdwatch_host_index "$1")
  herdwatch_lock docker-lock $((DOCKER_TIMEOUT_SECONDS + DOCKER_LOCK_MARGIN_SECONDS)) || return 0
  herdwatch_measure_host_docker "$index"
  herdwatch_unlock docker-lock
}

# The row goes at once, so the list is right also when a running Docker measure makes the re-measure wait.
herdwatch_remove_docker_container_row() {
  local docker_file
  docker_file=$(herdwatch_docker_file "$1")
  [ -r "$docker_file" ] || return 0
  awk -F '\t' -v id="$2" '/^\[[a-z]+\]$/ { section = $0 } !(section == "[containers]" && $1 == id)' \
    "$docker_file" >"$docker_file.$$.tmp" && mv "$docker_file.$$.tmp" "$docker_file"
}

herdwatch_docker_result() {
  local name="$1" label="$2" container_id="${3:-}"
  case "$(herdwatch_action_output_value result)" in
    ok) ;;
    docker_missing) herdwatch_action_failed docker_missing "Docker is not installed on $label."; return ;;
    docker_denied)
      herdwatch_action_failed docker_denied "The SSH user of $label cannot reach Docker. Add it to the docker group, then log in again."
      return
      ;;
    *) herdwatch_action_failed remote_error "Docker refused the action." "$(herdwatch_action_output_value error)"; return ;;
  esac
  case "$name" in
    docker-stop) herdwatch_remeasure_docker "$label"; herdwatch_action_succeeded "Stopped the container." ;;
    docker-rm)
      herdwatch_remove_docker_container_row "$label" "$container_id"
      herdwatch_remeasure_docker "$label"
      herdwatch_action_succeeded "Removed the container."
      ;;
    docker-prune-preview)
      herdwatch_action_succeeded "Measured the space that prune frees." \
        "{\"images_kb\":$(herdwatch_action_output_number images_kb),\"volumes_kb\":$(herdwatch_action_output_number volumes_kb)}"
      ;;
    docker-prune)
      herdwatch_remeasure_docker "$label"
      herdwatch_action_succeeded "Pruned unused Docker data." "{\"reclaimed_kb\":$(herdwatch_action_output_number reclaimed_kb)}"
      ;;
  esac
}

herdwatch_action_docker_container() {
  local name="$1" label="$2" container_id="${3:-}" stored_state
  if ! [[ $container_id =~ $DOCKER_CONTAINER_ID_PATTERN ]]; then
    herdwatch_action_failed bad_input "The container id $container_id is not a Docker id."
    return 0
  fi
  stored_state=$(herdwatch_stored_container_state "$label" "$container_id")
  if [ -z "$stored_state" ]; then
    herdwatch_action_failed bad_input "This container is not in the last Docker measure of $label. Wait for the next measure."
    return 0
  fi
  if [ "$name" = docker-rm ] && [ "$stored_state" = running ]; then
    herdwatch_action_failed bad_input "The container runs. Stop it first."
    return 0
  fi
  herdwatch_take_action_lock "$label" || return 0
  herdwatch_run_remote_action "$label" docker_action "$DOCKER_ACTION_TIMEOUT_SECONDS" "${name#docker-}" "$container_id" &&
    herdwatch_docker_result "$name" "$label" "$container_id"
  herdwatch_unlock "action-$label"
}

herdwatch_action_docker_prune() {
  local label="$1" argument is_preview=false prune_scope=images
  for argument in "${@:2}"; do
    case "$argument" in
      --preview) is_preview=true ;;
      --volumes) prune_scope=images-and-volumes ;;
    esac
  done
  herdwatch_take_action_lock "$label" || return 0
  if [ "$is_preview" = true ]; then
    herdwatch_run_remote_action "$label" docker_action "$DOCKER_ACTION_TIMEOUT_SECONDS" prune-preview &&
      herdwatch_docker_result docker-prune-preview "$label"
  else
    herdwatch_run_remote_action "$label" docker_action "$DOCKER_ACTION_TIMEOUT_SECONDS" prune "$prune_scope" &&
      herdwatch_docker_result docker-prune "$label"
  fi
  herdwatch_unlock "action-$label"
}

herdwatch_run_action() {
  local name="${1:-}" label="${2:-}"
  if ! herdwatch_is_action_name "$name"; then
    herdwatch_usage
    exit 2
  fi
  shift
  [ "$#" -gt 0 ] && shift
  ACTION_OUTPUT="$RUNTIME_DIR/action.$$.out"
  ACTION_STDERR="$RUNTIME_DIR/action.$$.err"
  trap 'rm -f "$ACTION_OUTPUT" "$ACTION_STDERR"' EXIT
  herdwatch_seed_config
  herdwatch_load_settings
  herdwatch_load_hosts
  herdwatch_load_pins
  if ! herdwatch_has_label "$label"; then
    herdwatch_action_failed bad_input "No host named $label in hosts.conf."
    return 0
  fi
  case "$name" in
    pin | unpin) herdwatch_action_pin "$name" "$label" "$@" ;;
    kill) herdwatch_action_kill "$label" "$@" ;;
    worktree-remove) herdwatch_action_worktree_remove "$label" "$@" ;;
    docker-stop | docker-rm) herdwatch_action_docker_container "$name" "$label" "$@" ;;
    docker-prune) herdwatch_action_docker_prune "$label" "$@" ;;
  esac
}
