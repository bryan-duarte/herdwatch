# shellcheck shell=sh
# herdwatch action: worktree_remove <absolute path> <force: 0|1> <branch to delete, or empty>.
# Checks the worktree again right before the delete, because the console's view can be minutes old.
# Prints result=ok|gone|main_checkout|process_inside|dirty|remote_error|branch_not_merged and details.
LC_ALL=C
export LC_ALL
worktree_dir="$1"
force="$2"
branch="$3"
error_file=$(mktemp)
trap 'rm -f "$error_file"' EXIT

# Git prints hints after the error, so the "error:" line wins over the last line.
last_error_line() {
  grep -m 1 '^error:' "$error_file" || grep -v '^$' "$error_file" | tail -n 1
}

# A process whose folder is the worktree or a folder in it. Linux reads /proc; macOS asks lsof.
first_process_inside() {
  if [ -d /proc/self ]; then
    for process_dir in /proc/[0-9]*; do
      process_cwd=$(readlink "$process_dir/cwd" 2>/dev/null) || continue
      case "$process_cwd" in "$worktree_dir" | "$worktree_dir"/*) echo "${process_dir#/proc/}"; return 0 ;; esac
    done
    return 0
  fi
  lsof -a -d cwd -Fpn 2>/dev/null | awk -v folder="$worktree_dir" '
    /^p/ { pid = substr($0, 2) }
    /^n/ { path = substr($0, 2); if (path == folder || index(path, folder "/") == 1) { print pid; exit } }'
}

remove_worktree() {
  if [ "$force" = 1 ]; then
    git -C "$common_dir" worktree remove --force "$worktree_dir" 2>"$error_file"
  else
    git -C "$common_dir" worktree remove "$worktree_dir" 2>"$error_file"
  fi
}

if [ ! -d "$worktree_dir" ]; then
  echo "result=gone"
  exit 0
fi
# git before 2.31 has no --path-format, so cd makes the common dir absolute.
git_dir=$(git -C "$worktree_dir" rev-parse --absolute-git-dir 2>/dev/null)
[ -n "$git_dir" ] && git_dir=$(cd "$git_dir" 2>/dev/null && pwd -P)
common_dir=$(cd "$worktree_dir" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)
if [ -z "$git_dir" ] || [ "$git_dir" = "$common_dir" ]; then
  echo "result=main_checkout"
  exit 0
fi
process_inside=$(first_process_inside)
if [ -n "$process_inside" ]; then
  echo "result=process_inside"
  echo "pid=$process_inside"
  exit 0
fi
changed_files=$(git -C "$worktree_dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$changed_files" -gt 0 ] && [ "$force" != 1 ]; then
  echo "result=dirty"
  echo "changed_files=$changed_files"
  exit 0
fi
if ! remove_worktree; then
  echo "result=remote_error"
  echo "error=$(last_error_line)"
  exit 0
fi
if [ -n "$branch" ] && ! git -C "$common_dir" branch -d "$branch" 2>"$error_file"; then
  echo "result=branch_not_merged"
  echo "error=$(last_error_line)"
  exit 0
fi
echo "result=ok"
exit 0
