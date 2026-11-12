# shellcheck shell=bash
HERDWATCH_NUMERIC_SETTING_KEYS="WARN CRIT TOP_N SSH_TIMEOUT PANE_REFRESH ALERT_POLLS STALE_SECONDS WORKTREE_DEPTH WORKTREE_INTERVAL WORKTREE_TIMEOUT DOCKER_INTERVAL"
HERDWATCH_WORKTREE_ROOT_PATTERN='^[A-Za-z0-9._/~-]+$'
HERDWATCH_BRANCH_NAME_PATTERN='^[A-Za-z0-9._/-]+$'
HERDWATCH_MAX_WORKTREE_ROOTS=8
HERDWATCH_MAX_MERGED_BRANCHES=8
HERDWATCH_LABEL_PATTERN='^[A-Za-z0-9_][A-Za-z0-9._-]{0,23}$'
HERDWATCH_MAX_PERCENT=100
HERDWATCH_CONFIG_FILES="hosts.conf settings.conf pins.conf"

herdwatch_seed_config() {
  local config_name
  for config_name in $HERDWATCH_CONFIG_FILES; do
    [ -e "$CONFIG_DIR/$config_name" ] || cp "$HERDWATCH_ROOT/examples/$config_name" "$CONFIG_DIR/$config_name"
  done
}

herdwatch_default_settings() {
  WARN=70
  CRIT=90
  TOP_N=30
  SSH_TIMEOUT=3
  PANE_REFRESH=2
  ALERTS=on
  ALERT_POLLS=3
  STALE_SECONDS=30
  AGENT_PATTERN='(^|/)(claude|codex|gemini|copilot|cursor-agent|opencode|crush|amp|goose|droid|qwen|pi|pig|omp|aider|kimi|kiro-cli|cline|auggie|cn|kilo|kilocode|grok|devin|letta|hermes|qodercli|qoder|mastracode|jules|agy|openhands|plandex|pdx|dsh-tui|node|bun|python[0-9.]*)$|/claude/versions/'
  WORKTREE_ROOTS='~'
  WORKTREE_DEPTH=7
  WORKTREE_INTERVAL=300
  WORKTREE_TIMEOUT=120
  MERGED_BRANCHES='main master develop trunk'
  DOCKER=on
  DOCKER_INTERVAL=300
  WARN_LINE=""
}

herdwatch_is_positive_integer() {
  case "$1" in
    '' | 0* | *[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

herdwatch_is_numeric_setting_key() {
  case " $HERDWATCH_NUMERIC_SETTING_KEYS " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

herdwatch_apply_numeric_setting() {
  local key="$1" setting_value="$2" line_number="$3"
  if ! herdwatch_is_positive_integer "$setting_value"; then
    herdwatch_problem settings.conf "$line_number" "$key" "$setting_value" not_a_positive_integer
    return
  fi
  local is_percent_key=false
  case "$key" in WARN | CRIT) is_percent_key=true ;; esac
  if [ "$is_percent_key" = true ] && [ "$setting_value" -gt "$HERDWATCH_MAX_PERCENT" ]; then
    herdwatch_problem settings.conf "$line_number" "$key" "$setting_value" above_100
    return
  fi
  [ "$key" = WARN ] && WARN_LINE="$line_number"
  printf -v "$key" '%s' "$setting_value"
}

herdwatch_is_valid_regex() {
  HERDWATCH_AGENT_PATTERN="$1" awk 'BEGIN { if ("" ~ ENVIRON["HERDWATCH_AGENT_PATTERN"]) exit 0 }' 2>/dev/null
}

herdwatch_is_valid_word_list() {
  local space_separated_words="$1" word_pattern="$2" max_words="$3" word word_count=0
  for word in $space_separated_words; do
    [[ $word =~ $word_pattern ]] || return 1
    word_count=$((word_count + 1))
  done
  [ "$word_count" -ge 1 ] && [ "$word_count" -le "$max_words" ]
}

herdwatch_apply_on_off_setting() {
  local key="$1" setting_value="$2" line_number="$3"
  case "$setting_value" in
    on | off) printf -v "$key" '%s' "$setting_value" ;;
    *) herdwatch_problem settings.conf "$line_number" "$key" "$setting_value" not_on_or_off ;;
  esac
}

herdwatch_apply_setting() {
  local key="$1" setting_value="$2" line_number="$3"
  if herdwatch_is_numeric_setting_key "$key"; then
    herdwatch_apply_numeric_setting "$key" "$setting_value" "$line_number"
    return
  fi
  case "$key" in
    AGENT_PATTERN)
      if herdwatch_is_valid_regex "$setting_value"; then
        AGENT_PATTERN="$setting_value"
      else
        herdwatch_problem settings.conf "$line_number" "$key" "$setting_value" bad_regex
      fi
      ;;
    WORKTREE_ROOTS)
      if herdwatch_is_valid_word_list "$setting_value" "$HERDWATCH_WORKTREE_ROOT_PATTERN" "$HERDWATCH_MAX_WORKTREE_ROOTS"; then
        WORKTREE_ROOTS="$setting_value"
      else
        herdwatch_problem settings.conf "$line_number" "$key" "$setting_value" bad_path_list
      fi
      ;;
    MERGED_BRANCHES)
      if herdwatch_is_valid_word_list "$setting_value" "$HERDWATCH_BRANCH_NAME_PATTERN" "$HERDWATCH_MAX_MERGED_BRANCHES"; then
        MERGED_BRANCHES="$setting_value"
      else
        herdwatch_problem settings.conf "$line_number" "$key" "$setting_value" bad_branch_list
      fi
      ;;
    ALERTS | DOCKER) herdwatch_apply_on_off_setting "$key" "$setting_value" "$line_number" ;;
    *) herdwatch_problem settings.conf "$line_number" "$key" "$setting_value" unknown_key ;;
  esac
}

herdwatch_config_is_unreadable() {
  [ -e "$1" ] && [ ! -r "$1" ]
}

herdwatch_load_settings() {
  local settings_file="$CONFIG_DIR/settings.conf" line line_number=0
  herdwatch_default_settings
  if herdwatch_config_is_unreadable "$settings_file"; then
    herdwatch_problem settings.conf "" "" "" unreadable
    return 0
  fi
  [ -r "$settings_file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line_number=$((line_number + 1))
    line="${line%$'\r'}"
    case "$line" in '' | '#'*) continue ;; esac
    herdwatch_apply_setting "${line%%=*}" "${line#*=}" "$line_number"
  done <"$settings_file"
  herdwatch_cap_warn_at_crit
}

herdwatch_cap_warn_at_crit() {
  [ "$WARN" -gt "$CRIT" ] || return 0
  herdwatch_problem settings.conf "$WARN_LINE" WARN "$WARN" above_crit
  WARN=$CRIT
}

herdwatch_host_index() {
  local index=0
  while [ "$index" -lt "$HOST_COUNT" ]; do
    if [ "${HOST_LABELS[$index]}" = "$1" ]; then
      echo "$index"
      return 0
    fi
    index=$((index + 1))
  done
  return 1
}

herdwatch_has_label() {
  herdwatch_host_index "$1" >/dev/null
}

herdwatch_is_acceptable_host() {
  local label="$1" target="$2" line_number="$3"
  if ! [[ $label =~ $HERDWATCH_LABEL_PATTERN ]]; then
    herdwatch_problem hosts.conf "$line_number" "$label" "$target" bad_label
    return 1
  fi
  case "$target" in
    '' | -*)
      herdwatch_problem hosts.conf "$line_number" "$label" "$target" bad_target
      return 1
      ;;
  esac
  if herdwatch_has_label "$label"; then
    herdwatch_problem hosts.conf "$line_number" "$label" "$target" duplicate
    return 1
  fi
}

herdwatch_load_hosts() {
  local hosts_file="$CONFIG_DIR/hosts.conf" label target _extra_columns line_number=0
  HOST_LABELS=()
  HOST_TARGETS=()
  HOST_COUNT=0
  if herdwatch_config_is_unreadable "$hosts_file"; then
    herdwatch_problem hosts.conf "" "" "" unreadable
    return 0
  fi
  [ -r "$hosts_file" ] || return 0
  while read -r label target _extra_columns || [ -n "$label" ]; do
    line_number=$((line_number + 1))
    label="${label%$'\r'}"
    target="${target%$'\r'}"
    case "$label" in '' | '#'*) continue ;; esac
    herdwatch_is_acceptable_host "$label" "$target" "$line_number" || continue
    HOST_LABELS[HOST_COUNT]="$label"
    HOST_TARGETS[HOST_COUNT]="$target"
    HOST_COUNT=$((HOST_COUNT + 1))
  done <"$hosts_file"
}
