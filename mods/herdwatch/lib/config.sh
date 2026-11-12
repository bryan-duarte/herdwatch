# shellcheck shell=bash
HERDWATCH_NUMERIC_SETTING_KEYS="WARN CRIT TOP_N SSH_TIMEOUT PANE_REFRESH ALERT_POLLS STALE_SECONDS WORKTREE_DEPTH WORKTREE_INTERVAL WORKTREE_TIMEOUT"
HERDWATCH_WORKTREE_ROOT_PATTERN='^[A-Za-z0-9._/~-]+$'
HERDWATCH_MAX_WORKTREE_ROOTS=8
HERDWATCH_LABEL_PATTERN='^[A-Za-z0-9_][A-Za-z0-9._-]{0,23}$'
HERDWATCH_MAX_PERCENT=100

herdwatch_seed_config() {
  local config_name
  for config_name in hosts.conf settings.conf; do
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
  local key="$1" setting_value="$2"
  if ! herdwatch_is_positive_integer "$setting_value"; then
    herdwatch_log settings_value_rejected "key=$key reason=not_a_positive_integer"
    return
  fi
  local is_percent_key=false
  case "$key" in WARN | CRIT) is_percent_key=true ;; esac
  if [ "$is_percent_key" = true ] && [ "$setting_value" -gt "$HERDWATCH_MAX_PERCENT" ]; then
    herdwatch_log settings_value_rejected "key=$key reason=above_100"
    return
  fi
  printf -v "$key" '%s' "$setting_value"
}

herdwatch_is_valid_regex() {
  HERDWATCH_AGENT_PATTERN="$1" awk 'BEGIN { if ("" ~ ENVIRON["HERDWATCH_AGENT_PATTERN"]) exit 0 }' 2>/dev/null
}

herdwatch_are_valid_worktree_roots() {
  local root root_count=0
  for root in $1; do
    [[ $root =~ $HERDWATCH_WORKTREE_ROOT_PATTERN ]] || return 1
    root_count=$((root_count + 1))
  done
  [ "$root_count" -ge 1 ] && [ "$root_count" -le "$HERDWATCH_MAX_WORKTREE_ROOTS" ]
}

herdwatch_apply_setting() {
  local key="$1" setting_value="$2"
  if herdwatch_is_numeric_setting_key "$key"; then
    herdwatch_apply_numeric_setting "$key" "$setting_value"
    return
  fi
  case "$key" in
    AGENT_PATTERN)
      if herdwatch_is_valid_regex "$setting_value"; then
        AGENT_PATTERN="$setting_value"
      else
        herdwatch_log settings_value_rejected "key=AGENT_PATTERN reason=bad_regex"
      fi
      ;;
    WORKTREE_ROOTS)
      if herdwatch_are_valid_worktree_roots "$setting_value"; then
        WORKTREE_ROOTS="$setting_value"
      else
        herdwatch_log settings_value_rejected "key=WORKTREE_ROOTS reason=bad_path_list"
      fi
      ;;
    ALERTS)
      case "$setting_value" in
        on | off) ALERTS="$setting_value" ;;
        *) herdwatch_log settings_value_rejected "key=ALERTS reason=not_on_or_off" ;;
      esac
      ;;
    *) herdwatch_log settings_key_unknown "key=$key" ;;
  esac
}

herdwatch_load_settings() {
  local settings_file="$CONFIG_DIR/settings.conf" line
  herdwatch_default_settings
  [ -r "$settings_file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in '' | '#'*) continue ;; esac
    herdwatch_apply_setting "${line%%=*}" "${line#*=}"
  done <"$settings_file"
  herdwatch_cap_warn_at_crit
}

herdwatch_cap_warn_at_crit() {
  [ "$WARN" -gt "$CRIT" ] || return 0
  herdwatch_log settings_value_rejected "key=WARN reason=above_CRIT"
  WARN=$CRIT
}

herdwatch_has_label() {
  local index=0
  while [ "$index" -lt "$HOST_COUNT" ]; do
    [ "${HOST_LABELS[$index]}" = "$1" ] && return 0
    index=$((index + 1))
  done
  return 1
}

herdwatch_is_acceptable_host() {
  local label="$1" target="$2"
  if ! [[ $label =~ $HERDWATCH_LABEL_PATTERN ]]; then
    herdwatch_log hosts_line_rejected "label=$label reason=bad_label"
    return 1
  fi
  case "$target" in
    '' | -*)
      herdwatch_log hosts_line_rejected "label=$label reason=bad_target"
      return 1
      ;;
  esac
  if herdwatch_has_label "$label"; then
    herdwatch_log hosts_line_rejected "label=$label reason=duplicate"
    return 1
  fi
}

herdwatch_load_hosts() {
  local hosts_file="$CONFIG_DIR/hosts.conf" label target _extra_columns
  HOST_LABELS=()
  HOST_TARGETS=()
  HOST_COUNT=0
  [ -r "$hosts_file" ] || return 0
  while read -r label target _extra_columns || [ -n "$label" ]; do
    label="${label%$'\r'}"
    target="${target%$'\r'}"
    case "$label" in '' | '#'*) continue ;; esac
    herdwatch_is_acceptable_host "$label" "$target" || continue
    HOST_LABELS[HOST_COUNT]="$label"
    HOST_TARGETS[HOST_COUNT]="$target"
    HOST_COUNT=$((HOST_COUNT + 1))
  done <"$hosts_file"
}
