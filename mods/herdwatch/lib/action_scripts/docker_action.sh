# shellcheck shell=sh
# herdwatch action: docker_action <stop|rm> <container id>, docker_action prune-preview, or
# docker_action prune <images|images-and-volumes>. Prints result=ok|docker_missing|docker_denied|remote_error,
# and for the prune actions images_kb and volumes_kb, or reclaimed_kb.
LC_ALL=C
export LC_ALL
action="$1"
argument="$2"
tab=$(printf '\t')
error_file=$(mktemp)
sizes_file=$(mktemp)
trap 'rm -f "$error_file" "$sizes_file"' EXIT

# Docker prints sizes in SI units (kB, MB, GB); the output is KiB.
kib_of_size='
  function kib_of(size_text,   number, unit, scale) {
    number = size_text; sub(/[A-Za-z]+.*$/, "", number)
    unit = size_text; sub(/^[0-9.]+/, "", unit); sub(/ .*/, "", unit)
    scale = 1
    if (unit == "kB" || unit == "KB") scale = 1000
    else if (unit == "MB") scale = 1000000
    else if (unit == "GB") scale = 1000000000
    else if (unit == "TB") scale = 1000000000000
    return int(number * scale / 1024)
  }'

fail_with_docker_error() {
  if grep -qi 'permission denied' "$error_file"; then
    echo "result=docker_denied"
  else
    echo "result=remote_error"
    echo "error=$(grep -v '^$' "$error_file" | tail -n 1)"
  fi
  exit 0
}

total_reclaimed_kb() {
  awk "$kib_of_size"'/^Total reclaimed space:/ { total += kib_of($4) } END { printf "%d", total }'
}

prune_volumes() {
  docker volume prune --all --force 2>/dev/null || docker volume prune --force 2>"$error_file"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "result=docker_missing"
  exit 0
fi
case "$action" in
  stop | rm)
    docker "$action" "$argument" >/dev/null 2>"$error_file" || fail_with_docker_error
    ;;
  prune-preview)
    docker system df --format "{{.Type}}$tab{{.Reclaimable}}" >"$sizes_file" 2>"$error_file" || fail_with_docker_error
    awk -F '\t' "$kib_of_size"'
      $1 == "Images" { images = kib_of($2) }
      $1 == "Local Volumes" { volumes = kib_of($2) }
      END { printf "images_kb=%d\nvolumes_kb=%d\n", images, volumes }' "$sizes_file"
    ;;
  prune)
    image_output=$(docker image prune --all --force 2>"$error_file") || fail_with_docker_error
    volume_output=''
    if [ "$argument" = images-and-volumes ]; then
      volume_output=$(prune_volumes) || fail_with_docker_error
    fi
    echo "reclaimed_kb=$(printf '%s\n%s\n' "$image_output" "$volume_output" | total_reclaimed_kb)"
    ;;
esac
echo "result=ok"
exit 0
