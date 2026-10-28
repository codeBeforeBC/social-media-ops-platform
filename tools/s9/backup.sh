#!/bin/sh
# Stop writers for one consistent database/object/credential recovery point; preserve prior service state.
set -eu
umask 077
project=${1:?usage: backup.sh PROJECT NEW_BACKUP_DIRECTORY COMPOSE_FILE...}
dest=${2:?new backup directory required}
shift 2
[ "$#" -gt 0 ] || { echo 'Explicit Compose files required' >&2; exit 1; }
case "$project" in *[!a-z0-9_-]*|'') echo 'Invalid project name' >&2; exit 1;; esac
compose() {
  # Build positional arguments without evaluating shell text.
  set -- "$@"
  docker compose -p "$project" $compose_files "$@"
}
compose_files=''
for file in "$@"; do
  case "$file" in *[!a-zA-Z0-9_./-]*) echo 'Compose file paths cannot contain spaces or shell characters' >&2; exit 1;; esac
  [ -f "$file" ] || { echo 'Compose file missing' >&2; exit 1; }
  compose_files="$compose_files -f $file"
done
[ ! -e "$dest" ] || { echo 'Backup destination must be new' >&2; exit 1; }
mkdir -m 700 "$dest"
dest=$(cd "$dest" && pwd)
running=$(compose ps --services --status running)
db=$(compose ps -q db)
[ -n "$db" ] || { echo 'Running database required' >&2; exit 1; }
app=$(compose images -q api | head -n 1)
# A live container may outlive its image manifest after a floating tag rebuild.
# Reading volumes needs a local tar-capable image, not the missing old manifest.
if [ -z "$app" ] || ! docker image inspect "$app" >/dev/null 2>&1; then
  app=$(compose config --images api | head -n 1)
fi
[ -n "$app" ] && docker image inspect "$app" >/dev/null 2>&1 || { echo 'Local snapshot image required' >&2; exit 1; }
resume() { [ -z "$running" ] || compose start $running >/dev/null; }
trap resume EXIT
trap 'exit 1' INT TERM
compose stop api worker media scheduler media-executor storage >/dev/null
compose exec -T db pg_dump -U yoyo -d yoyo -Fc > "$dest/database.dump"
for pair in "init state /state" "storage objects /data"; do
  set -- $pair
  container=$(compose ps -aq "$1")
  volume=$(docker inspect --format "{{range .Mounts}}{{if eq .Destination \"$3\"}}{{if eq .Type \"volume\"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}" "$container")
  [ -n "$volume" ] || { echo 'Required persistent data mount missing' >&2; exit 1; }
  docker run --rm --network none --read-only --user 0:0 --cap-drop ALL --cap-add DAC_OVERRIDE --security-opt no-new-privileges -v "$volume:/snapshot:ro" "$app" tar -C /snapshot -cf - . > "$dest/$2.tar"
done
proxy=$(compose ps -aq proxy 2>/dev/null || true)
if [ -n "$proxy" ]; then
  compose stop proxy >/dev/null
  volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$proxy")
  docker run --rm --network none --read-only --user 0:0 --cap-drop ALL --cap-add DAC_OVERRIDE --security-opt no-new-privileges -v "$volume:/snapshot:ro" "$app" tar -C /snapshot -cf - . > "$dest/proxy-data.tar"
fi
printf '%s\n' "$project" > "$dest/project.txt"
# A running container may outlive its image manifest after a floating tag rebuild.
# Keep actual container/image references without requiring every old image to be inspectable.
printf '[' > "$dest/images.json"
separator=''
containers=$(compose ps -aq)
[ -n "$containers" ] || { echo 'Backup container inventory is empty' >&2; exit 1; }
for container in $containers; do
  printf '%s' "$separator" >> "$dest/images.json"
  docker inspect --format '{"Container":{{json .Name}},"Image":{{json .Config.Image}},"ImageID":{{json .Image}}}' "$container" >> "$dest/images.json"
  separator=','
done
printf ']\n' >> "$dest/images.json"
(cd "$dest"; if command -v sha256sum >/dev/null 2>&1; then sha256sum database.dump state.tar objects.tar project.txt images.json > SHA256SUMS; else shasum -a 256 database.dump state.tar objects.tar project.txt images.json > SHA256SUMS; fi)
if [ -f "$dest/proxy-data.tar" ]; then
  (cd "$dest"; if command -v sha256sum >/dev/null 2>&1; then sha256sum proxy-data.tar; else shasum -a 256 proxy-data.tar; fi) >> "$dest/SHA256SUMS"
fi
resume
trap - EXIT
echo 'Consistent private backup complete; prior running services restored. Keep this directory restricted.'
