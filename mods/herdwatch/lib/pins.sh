# shellcheck shell=bash
HERDWATCH_MAX_PORT=65535
PINS_LOCK_STALE_SECONDS=10

herdwatch_pins_file() {
  printf '%s/pins.conf' "$CONFIG_DIR"
}

herdwatch_is_port() {
  herdwatch_is_positive_integer "$1" && [ "$1" -le "$HERDWATCH_MAX_PORT" ]
}

herdwatch_load_pins() {
  local pins_file label port _extra_columns line_number=0
  pins_file=$(herdwatch_pins_file)
  PIN_LABELS=()
  PIN_PORTS=()
  PIN_COUNT=0
  if herdwatch_config_is_unreadable "$pins_file"; then
    herdwatch_problem pins.conf "" "" "" unreadable
    return 0
  fi
  [ -r "$pins_file" ] || return 0
  while read -r label port _extra_columns || [ -n "$label" ]; do
    line_number=$((line_number + 1))
    label="${label%$'\r'}"
    port="${port%$'\r'}"
    case "$label" in '' | '#'*) continue ;; esac
    if ! herdwatch_has_label "$label"; then
      herdwatch_problem pins.conf "$line_number" "$label" "$port" unknown_host
      continue
    fi
    if ! herdwatch_is_port "$port"; then
      herdwatch_problem pins.conf "$line_number" "$label" "$port" bad_port
      continue
    fi
    PIN_LABELS[PIN_COUNT]="$label"
    PIN_PORTS[PIN_COUNT]="$port"
    PIN_COUNT=$((PIN_COUNT + 1))
  done <"$pins_file"
}

herdwatch_pins_of_label() {
  local index=0 ports=""
  while [ "$index" -lt "$PIN_COUNT" ]; do
    [ "${PIN_LABELS[$index]}" = "$1" ] && ports="$ports ${PIN_PORTS[$index]}"
    index=$((index + 1))
  done
  echo "${ports# }"
}

# Rewrites pins.conf without the line of this port, and adds it back for "pin". Comments stay.
herdwatch_rewrite_pins() {
  local change="$1" label="$2" port="$3" pins_file
  pins_file=$(herdwatch_pins_file)
  herdwatch_config_is_unreadable "$pins_file" && return 1
  herdwatch_lock pins-lock "$PINS_LOCK_STALE_SECONDS" || return 1
  {
    if [ -r "$pins_file" ]; then
      awk -v label="$label" -v port="$port" '{ line = $0; sub(/\r$/, "", line); split(line, words, " ") }
        !(words[1] == label && words[2] == port)' "$pins_file"
    fi
    if [ "$change" = pin ]; then
      printf '%s %s\n' "$label" "$port"
    fi
  } >"$pins_file.$$.tmp" && mv "$pins_file.$$.tmp" "$pins_file"
  local rewrite_status=$?
  herdwatch_unlock pins-lock
  return "$rewrite_status"
}
