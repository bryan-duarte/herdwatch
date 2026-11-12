# shellcheck shell=sh
# herdwatch action: kill_tree <pid> <TERM|KILL> [survivor pid...]. Sends the signal to the process and its
# descendants, children first, and to the survivors of an earlier try, then waits for them.
# Prints result=ok|gone|not_owner|still_running, killed=<pids> and alive=<pids>.
# The tree comes from the process table at kill time, never from an older poll, because pids are reused.
LC_ALL=C
export LC_ALL
root_pid="$1"
signal="$2"
shift 2
survivor_pids="$*"
wait_steps=10
wait_step_seconds=0.5
error_file=$(mktemp)
trap 'rm -f "$error_file"' EXIT
process_table=$(ps -A -o pid=,ppid= 2>/dev/null)

is_running() {
  process_state=$(ps -o stat= -p "$1" 2>/dev/null)
  case "$process_state" in
    '' | Z*) return 1 ;;
    *) return 0 ;;
  esac
}

# This script and the SSH session that runs it must survive, also when the tree holds them.
ancestors_of_this_script() {
  printf '%s\n' "$process_table" | awk -v pid="$$" '
    { parent_of[$1] = $2 }
    END { while (pid != "" && pid > 1 && !(pid in seen)) { seen[pid] = 1; printf " %s", pid; pid = parent_of[pid] } }'
}

tree_children_first() {
  printf '%s\n' "$process_table" | awk -v root="$root_pid" -v spared="$spared_pids" '
    { children[$2] = children[$2] " " $1 }
    function visit(pid,   count, child_list, position) {
      count = split(children[pid], child_list, " ")
      for (position = 1; position <= count; position++) visit(child_list[position])
      if (!index(spared, " " pid " ")) print pid
    }
    END { visit(root) }'
}

running_pids() {
  for pid in $1; do
    is_running "$pid" && printf '%s ' "$pid"
  done
}

running_survivors() {
  for pid in $survivor_pids; do
    case "$spared_pids" in *" $pid "*) continue ;; esac
    is_running "$pid" && printf ' %s' "$pid"
  done
}

spared_pids=" $(ancestors_of_this_script) "
tree=''
is_running "$root_pid" && tree=$(tree_children_first | tr '\n' ' ')
tree="$tree$(running_survivors)"
if [ -z "$tree" ]; then
  echo "result=gone"
  exit 0
fi
is_refused=0
for pid in $tree; do
  if ! kill -s "$signal" "$pid" 2>"$error_file"; then
    grep -qi 'not permitted' "$error_file" && is_refused=1
  fi
done
step=0
alive=$(running_pids "$tree")
while [ -n "$alive" ] && [ "$step" -lt "$wait_steps" ]; do
  sleep "$wait_step_seconds"
  alive=$(running_pids "$alive")
  step=$((step + 1))
done
killed=''
for pid in $tree; do
  case " $alive " in *" $pid "*) ;; *) killed="$killed $pid" ;; esac
done
if [ -z "$alive" ]; then
  echo "result=ok"
elif [ "$is_refused" = 1 ]; then
  echo "result=not_owner"
else
  echo "result=still_running"
fi
echo "killed=${killed# }"
echo "alive=${alive% }"
exit 0
