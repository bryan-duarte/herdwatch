# shellcheck shell=bash
PROBLEM_FIELD_MAX_CHARACTERS=120
HERDWATCH_PROBLEM_ROWS=""

herdwatch_problem_field() {
  printf '%s' "$1" | LC_ALL=C tr '\t\r\n' '   ' | cut -c1-"$PROBLEM_FIELD_MAX_CHARACTERS"
}

herdwatch_problem() {
  local file_name="$1" line_number="$2" key="$3" rejected_value="$4" reason="$5"
  HERDWATCH_PROBLEM_ROWS+="$file_name"$'\t'"$line_number"$'\t'"$(herdwatch_problem_field "$key")"$'\t'
  HERDWATCH_PROBLEM_ROWS+="$(herdwatch_problem_field "$rejected_value")"$'\t'"$reason"$'\n'
  herdwatch_log config_problem "file=$file_name line=$line_number key=$key reason=$reason"
}

herdwatch_print_problems_json() {
  printf '%s' "$HERDWATCH_PROBLEM_ROWS" | awk -v mode=problems -f "$HERDWATCH_ROOT/lib/snapshot.awk"
}
