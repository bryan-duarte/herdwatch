# shellcheck shell=sh
# herdwatch worktree probe v2. The collector sends this file over ssh stdin: sh -s -- <max_depth> <root>...
# Output: "worktrees=1", "--worktrees--", then one row per linked worktree: size_kb, tool, repository, branch,
# path (~), changed files, ahead, behind, last commit (epoch), absolute path.
# A linked worktree has a ".git" file "gitdir: <repo>/.git/worktrees/<name>", and the main repository lists each
# one in "<repo>/.git/worktrees/<name>/gitdir", so the tool that made a worktree does not matter.
LC_ALL=C
export LC_ALL
default_max_depth=7
max_depth="${1:-$default_max_depth}"
[ "$#" -gt 0 ] && shift
[ "$#" -gt 0 ] || set -- "$HOME"
tab=$(printf '\t')
candidates=$(mktemp)

absolute_dir() {
  (cd "$1" 2>/dev/null && pwd -P)
}

resolve_against() {
  case "$2" in
    /*) printf '%s\n' "$2" ;;
    *) printf '%s/%s\n' "$1" "$2" ;;
  esac
}

add_candidate() {
  worktree_dir=$(absolute_dir "$1") || return 0
  admin_dir=$(absolute_dir "$2") || return 0
  printf '%s\t%s\n' "$worktree_dir" "$admin_dir" >>"$candidates"
}

add_worktree_from_git_file() {
  worktree_dir=${1%/.git}
  admin_dir=$(sed -n 's/^gitdir: *//p' "$1" 2>/dev/null | head -n 1)
  case "$admin_dir" in
    */modules/* | '') return 0 ;;
    */worktrees/*) add_candidate "$worktree_dir" "$(resolve_against "$worktree_dir" "$admin_dir")" ;;
  esac
}

add_worktrees_from_registry() {
  for gitdir_file in "$1"/worktrees/*/gitdir; do
    [ -r "$gitdir_file" ] || continue
    admin_dir=${gitdir_file%/gitdir}
    worktree_git=$(resolve_against "$admin_dir" "$(head -n 1 "$gitdir_file")")
    [ -e "$worktree_git" ] && add_candidate "${worktree_git%/.git}" "$admin_dir"
  done
}

find_git_entries() {
  find "$1" -maxdepth "$max_depth" \
    \( -name node_modules -o -name .cache -o -name Library -o -name .npm -o -name .pnpm-store -o -name .yarn \
    -o -name .cargo -o -name .rustup -o -name .gradle -o -name .m2 -o -name .venv -o -name venv \
    -o -name __pycache__ -o -name site-packages -o -name .Trash -o -name .docker -o -name snap \) -prune \
    -o \( -name .git -type d -print -prune \) -o \( -name .git -type f -print \) 2>/dev/null
}

collect_candidates() {
  for root in "$@"; do
    [ -d "$root" ] || continue
    find_git_entries "$root" | while IFS= read -r git_entry; do
      if [ -d "$git_entry" ]; then
        add_worktrees_from_registry "$git_entry"
      else
        add_worktree_from_git_file "$git_entry"
      fi
    done
  done
}

branch_of() {
  head_line=$(head -n 1 "$1/HEAD" 2>/dev/null)
  case "$head_line" in
    'ref: refs/heads/'*) printf '%s\n' "${head_line#ref: refs/heads/}" ;;
    '') printf '?\n' ;;
    *) printf 'detached %s\n' "$(printf '%s' "$head_line" | cut -c1-7)" ;;
  esac
}

repository_of() {
  repository_dir=${1%/worktrees/*}
  repository_dir=${repository_dir%/.git}
  repository_name=${repository_dir##*/}
  printf '%s\n' "${repository_name%.git}"
}

# <folder>/.<tool>/worktrees/... (Claude, Codex, Cursor, Herdr, Qoder, Letta and others): the dot folder names the tool.
dot_folder_tool() {
  tool_folder=${1%%/worktrees/*}
  tool_folder=${tool_folder##*/}
  tool=${tool_folder#.}
  case "$tool_folder" in
    .*) ;;
    *) echo "git"; return 0 ;;
  esac
  case "$tool" in
    '' | *[!a-z0-9-]*) echo "git" ;;
    *) echo "$tool" ;;
  esac
}

tool_of() {
  case "$1" in
    */.codex*/worktrees/*) echo "codex" ;;
    */.factory/worktrees/*) echo "droid" ;;
    */conductor/workspaces/* | */.conductor/*) echo "conductor" ;;
    */.omp/wt/*) echo "omp" ;;
    *vibe-kanban*) echo "vibe-kanban" ;;
    */.*/worktrees/*) dot_folder_tool "$1" ;;
    *) echo "git" ;;
  esac
}

home_relative() {
  home_marker='~'
  case "$1" in
    "$HOME"/*) printf '%s/%s\n' "$home_marker" "${1#"$HOME"/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

worktree_health() {
  status_output=$(git -C "$1" status --porcelain=v2 --branch --ignore-submodules 2>/dev/null)
  changed_files=$(printf '%s\n' "$status_output" | grep -c -v '^#')
  ahead_behind=$(printf '%s\n' "$status_output" | sed -n 's/^# branch\.ab +\([0-9]*\) -\([0-9]*\)$/\1\t\2/p')
  last_commit=$(git -C "$1" log -1 --format=%ct 2>/dev/null)
  printf '%s\t%s\t%s' "$changed_files" "${ahead_behind:-0	0}" "${last_commit:-0}"
}

print_worktree_rows() {
  sort -u -t "$tab" -k1,1 "$candidates" | while IFS="$tab" read -r worktree_dir admin_dir; do
    size_kb=$(du -sk "$worktree_dir" 2>/dev/null | cut -f1)
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "${size_kb:-0}" "$(tool_of "$worktree_dir")" "$(repository_of "$admin_dir")" \
      "$(branch_of "$admin_dir")" "$(home_relative "$worktree_dir")" "$(worktree_health "$worktree_dir")" "$worktree_dir"
  done
}

collect_candidates "$@"
echo "worktrees=1"
echo "--worktrees--"
print_worktree_rows
rm -f "$candidates"
exit 0
