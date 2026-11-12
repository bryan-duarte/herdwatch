# shellcheck shell=sh
# herdwatch docker probe v1. The collector sends this file over ssh stdin: sh -s.
# Output: "docker=1" (or "docker=missing", "docker=denied", "docker=failed" with "error=<line>"), total_kb and
# reclaimable_kb (unused images and volumes), then the tab-separated sections --containers-- (id, name, image, state,
# created epoch, size_kb), --images-- (id, repository, tag, size_kb, dangling) and --volumes-- (name, size_kb, unused).
LC_ALL=C
export LC_ALL
tab=$(printf '\t')
error_file=$(mktemp)
trap 'rm -f "$error_file"' EXIT

# Docker prints sizes in SI units (kB, MB, GB); the output is KiB.
size_functions='
  function kib_of(size_text,   number, unit, scale) {
    number = size_text; sub(/[A-Za-z]+.*$/, "", number)
    unit = size_text; sub(/^[0-9.]+/, "", unit); sub(/ .*/, "", unit)
    scale = 1
    if (unit == "kB" || unit == "KB") scale = 1000
    else if (unit == "MB") scale = 1000000
    else if (unit == "GB") scale = 1000000000
    else if (unit == "TB") scale = 1000000000000
    return int(number * scale / 1024)
  }
  function epoch_of(created,   parts, date_parts, time_parts, year, month, days, zone, zone_sign, zone_seconds) {
    if (split(created, parts, " ") < 3) return ""
    split(parts[1], date_parts, "-"); split(parts[2], time_parts, ":")
    year = date_parts[1] + 0; month = date_parts[2] + 0
    if (month <= 2) { year--; month += 12 }
    days = 365 * year + int(year / 4) - int(year / 100) + int(year / 400) + int((153 * (month - 3) + 2) / 5) + date_parts[3] - 719469
    zone = parts[3]; zone_sign = substr(zone, 1, 1) == "-" ? -1 : 1
    zone_seconds = zone_sign * (substr(zone, 2, 2) * 3600 + substr(zone, 4, 2) * 60)
    return days * 86400 + time_parts[1] * 3600 + time_parts[2] * 60 + int(time_parts[3]) - zone_seconds
  }'

print_totals() {
  docker system df --format "{{.Type}}$tab{{.Size}}$tab{{.Reclaimable}}" 2>/dev/null | awk -F '\t' "$size_functions"'
    { total += kib_of($2) }
    $1 == "Images" || $1 == "Local Volumes" { reclaimable += kib_of($3) }
    END { printf "total_kb=%d\nreclaimable_kb=%d\n", total, reclaimable }'
}

print_containers() {
  echo "--containers--"
  docker ps -a --no-trunc --size --format "{{.ID}}$tab{{.Names}}$tab{{.Image}}$tab{{.State}}$tab{{.CreatedAt}}$tab{{.Size}}" 2>/dev/null |
    awk -F '\t' "$size_functions"'{ printf "%s\t%s\t%s\t%s\t%s\t%d\n", $1, $2, $3, $4, epoch_of($5), kib_of($6) }'
}

print_images() {
  echo "--images--"
  docker images --no-trunc --format "{{.ID}}$tab{{.Repository}}$tab{{.Tag}}$tab{{.Size}}" 2>/dev/null |
    awk -F '\t' "$size_functions"'{ id = $1; sub(/^sha256:/, "", id); printf "%s\t%s\t%s\t%d\t%d\n", id, $2, $3, kib_of($4), ($2 == "<none>") }'
}

# "docker system df -v" is the only place that gives volume sizes: a "VOLUME NAME LINKS SIZE" table.
print_volumes() {
  echo "--volumes--"
  docker system df -v 2>/dev/null | awk "$size_functions"'
    /^Local Volumes/ { in_volumes = 1; next }
    in_volumes && /^VOLUME NAME/ { in_table = 1; next }
    in_table && NF == 0 { in_volumes = 0; in_table = 0 }
    in_table && NF >= 3 { printf "%s\t%d\t%d\n", $1, kib_of($3), ($2 == 0) }'
}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker=missing"
  exit 0
fi
if ! docker info >/dev/null 2>"$error_file"; then
  if grep -qi 'permission denied' "$error_file"; then
    echo "docker=denied"
  else
    echo "docker=failed"
    echo "error=$(grep -v '^$' "$error_file" | tail -n 1)"
  fi
  exit 0
fi
echo "docker=1"
print_totals
print_containers
print_images
print_volumes
exit 0
