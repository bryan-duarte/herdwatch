HERDWATCH_RECORD_KEYS="label target state polled_at updated_at error os ncpu cpu_pct load mem_total_kb mem_used_kb mem_pct swap_total_kb swap_used_kb swap_pct procs disk_pct"
HERDWATCH_SECTION_PATTERN='^\[[a-z]+\]$'
HERDWATCH_PROCESS_SECTION="[procs]"

herdwatch_record_file() {
  printf '%s/hosts/%s.rec' "$STATE_DIR" "$1"
}

herdwatch_read_record() {
  local record_file="$1" line key
  for key in $HERDWATCH_RECORD_KEYS; do
    printf -v "record_$key" '%s' ""
  done
  [ -r "$record_file" ] || return 1
  while IFS= read -r line; do
    [[ $line =~ $HERDWATCH_SECTION_PATTERN ]] && break
    key="${line%%=*}"
    case " $HERDWATCH_RECORD_KEYS " in
      *" $key "*) printf -v "record_$key" '%s' "${line#*=}" ;;
    esac
  done <"$record_file"
}

herdwatch_record_processes() {
  awk -v section="$HERDWATCH_PROCESS_SECTION" 'in_section && /^\[[a-z]+\]$/ { exit } in_section { print } $0 == section { in_section = 1 }' "$1"
}

herdwatch_is_whole_number() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

herdwatch_is_at_or_above() {
  herdwatch_is_whole_number "$1" && [ "$1" -ge "$2" ]
}
