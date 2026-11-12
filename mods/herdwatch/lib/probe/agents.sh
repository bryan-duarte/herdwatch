# shellcheck shell=sh
agent_commands=' claude codex cursor-agent opencode aider gemini agy omp amp goose droid copilot crush qwen kiro-cli pi pig kimi
  cline plandex pdx kilo kilocode auggie cn grok devin letta hermes qodercli qoder mastracode jules openhands dsh-tui '
agent_commands=" $(printf '%s\n' "$agent_commands" | tr -s ' \n' '  ' | sed 's/^ *//; s/ *$//') "
agent_command_pattern=$(printf '%s' "$agent_commands" | sed 's/^ *//; s/ *$//; s/ /|/g')
agent_program_pattern='(^|/)('"$agent_command_pattern"')([.][mc]?js)?$|/('"$agent_command_pattern"')/versions/|/[.]claude/remote/ccd-cli/'
interpreter_pattern='(^|/)(node|bun|deno|python[0-9.]*)$'

# The key of Herdr.app's program table, so a process matches the agent Herdr reports.
canonical_agent() {
  case "$1" in
    cursor-agent) echo cursor ;;
    kiro-cli) echo kiro ;;
    agy) echo antigravity ;;
    qodercli) echo qoder ;;
    kilocode) echo kilo ;;
    pdx) echo plandex ;;
    cn) echo continue ;;
    *) echo "$1" ;;
  esac
}

agent_from_command_name() {
  command_name=${1##*/}
  command_name=${command_name%.js}
  command_name=${command_name%.mjs}
  command_name=${command_name%.cjs}
  case "$agent_commands" in
    *" $command_name "*) canonical_agent "$command_name"; return 0 ;;
  esac
  return 1
}

# Native installers keep each release in <name>/versions/<release>, so the program file has the release as its name.
agent_from_install_folder() {
  case "$1" in
    */versions/*) install_folder=${1%%/versions/*} ;;
    *) return 1 ;;
  esac
  agent_from_command_name "${install_folder##*/}"
}

is_interpreter() {
  case "${1##*/}" in
    node | bun | deno | python | python[0-9]*) return 0 ;;
    *) return 1 ;;
  esac
}

agent_from_program() {
  program_path="$1"
  script_path="$2"
  case "$program_path" in
    */.claude/remote/ccd-cli/*) echo claude; return 0 ;;
    */.claude/remote/srv/* | *claude-desktop*) return 1 ;;
  esac
  launched_path="$program_path"
  is_interpreter "$program_path" && launched_path="$script_path"
  agent_from_install_folder "$launched_path" || agent_from_command_name "$launched_path"
}

# The script of an interpreter is its first argument that is not a flag (node --max-old-space-size=N cli.js, python -m aider).
print_script_argument() {
  awk -v first_argument="$1" '{ for (i = first_argument; i <= NF; i++) if ($i !~ /^-/) { print $i; exit } }'
}

# Input: ps rows "pid ppid elapsed cpu mem program arguments...". Output: the rows that may be an agent, with the script path.
filter_agent_candidates() {
  awk -v agent_pattern="$agent_program_pattern" -v interpreters="$interpreter_pattern" '
    BEGIN { PROGRAM = 6; FIRST_ARGUMENT = 7 }
    {
      script_path = "-"
      for (i = FIRST_ARGUMENT; i <= NF; i++) if ($i !~ /^-/) { script_path = $i; break }
      launches_agent = ($PROGRAM ~ agent_pattern) || ($PROGRAM ~ interpreters && script_path ~ agent_pattern)
      if (launches_agent) print $1, $2, $3, $4, $5, $PROGRAM, script_path
    }'
}

# Always two tab-separated fields (empty outside a repository), so the columns after them keep their place.
print_repository_details() {
  git_output=$(git -C "$1" rev-parse --abbrev-ref HEAD --path-format=absolute --git-common-dir 2>/dev/null) || {
    printf '\t'
    return 0
  }
  branch=$(printf '%s\n' "$git_output" | sed -n 1p)
  common_dir=$(printf '%s\n' "$git_output" | sed -n 2p)
  common_dir=${common_dir%/}
  case "$common_dir" in
    */.git) repository=${common_dir%/.git} ;;
    *) repository=${common_dir%.git} ;;
  esac
  printf '%s\t%s' "$branch" "${repository##*/}"
}

# An agent often runs helper processes of the same app; only the top process of each app counts as a session.
drop_child_processes_of_same_agent() {
  awk -F '\t' 'NR == FNR { app_of[$1] = $3; next } app_of[$2] != $3' "$1" "$1"
}

# Input: candidate rows "pid ppid elapsed cpu mem program script cwd". Output: the --agents-- rows.
print_agent_rows() {
  candidates_file="$1"
  agents_file="$work_dir/agents"
  : >"$agents_file"
  while IFS="$tab" read -r pid ppid elapsed cpu mem program_path script_path cwd; do
    app=$(agent_from_program "$program_path" "$script_path") || continue
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$ppid" "$app" "$elapsed" "$cpu" "$mem" "$cwd" >>"$agents_file"
  done <"$candidates_file"
  drop_child_processes_of_same_agent "$agents_file" |
    while IFS="$tab" read -r pid _ppid app elapsed cpu mem cwd; do
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$app" "$elapsed" "$cpu" "$mem" "$cwd" "$(print_repository_details "$cwd")"
    done
}
