#!/bin/sh
# Restore only into a new project with empty owned volumes; never replace a live instance.
set -eu
umask 077
project=${1:?usage: restore.sh NEW_PROJECT BACKUP_DIRECTORY COMPOSE_FILE...}
backup=${2:?backup directory required}
shift 2
case "$project" in *[!a-z0-9_-]*|'') echo 'Invalid project name' >&2; exit 1;; esac
[ "$#" -gt 0 ] || { echo 'Explicit Compose files required' >&2; exit 1; }
[ -d "$backup" ] || { echo 'Backup directory missing' >&2; exit 1; }
backup=$(cd "$backup" && pwd)
compose_files=''
for file in "$@"; do
 case "$file" in *[!a-zA-Z0-9_./-]*) echo 'Unsafe Compose path' >&2; exit 1;; esac
 [ -f "$file" ] || { echo 'Compose file missing' >&2; exit 1; }
 compose_files="$compose_files -f $file"
done
compose() { docker compose -p "$project" $compose_files "$@"; }
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ] || { echo 'Restore target already has containers' >&2; exit 1; }
[ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" ] || { echo 'Restore target already has volumes' >&2; exit 1; }
for file in database.dump state.tar objects.tar project.txt images.json SHA256SUMS; do
 [ -f "$backup/$file" ] || { echo 'Required backup file missing' >&2; exit 1; }
done
awk 'NF!=2 || $1 !~ /^[a-f0-9]+$/ || length($1)!=64 || $2 !~ /^(database.dump|state.tar|objects.tar|project.txt|images.json|proxy-data.tar)$/ {bad=1} {if(seen[$2]++)bad=1} END {if(!seen["database.dump"]||!seen["state.tar"]||!seen["objects.tar"]||!seen["project.txt"]||!seen["images.json"])bad=1;exit bad}' "$backup/SHA256SUMS" || { echo 'Invalid backup checksum manifest' >&2; exit 1; }
[ ! -f "$backup/proxy-data.tar" ] || grep -q '  proxy-data.tar$' "$backup/SHA256SUMS" || { echo 'CA archive checksum missing' >&2; exit 1; }
(cd "$backup"; if command -v sha256sum >/dev/null 2>&1; then sha256sum -c SHA256SUMS; else shasum -a 256 -c SHA256SUMS; fi)
for file in state.tar objects.tar proxy-data.tar; do
 [ ! -f "$backup/$file" ] || {
  tar -tf "$backup/$file" | awk '/^\// || /(^|\/)\.\.(\/|$)/ {exit 1}' || { echo 'Unsafe archive path' >&2; exit 1; }
  tar -tvf "$backup/$file" | awk 'substr($0,1,1)!="d" && substr($0,1,1)!="-" {exit 1}' || { echo 'Archive links or special files forbidden' >&2; exit 1; }
 }
done
app="yoyo-release:${YOYO_VERSION:?explicit release version required}-${YOYO_ARCH:?explicit architecture required}"
platform="linux/$YOYO_ARCH"
# Validate effective volume ownership before Compose can create or attach anything.
compose config --format json | docker run --rm --network none --read-only --cap-drop ALL -i "$app" node -e 'let value="";process.stdin.on("data",c=>value+=c);process.stdin.on("end",()=>{const cfg=JSON.parse(value),project=process.argv[1];for(const [key,v] of Object.entries(cfg.volumes??{})){if(v.external||v.name!==project+"_"+key){console.error("Only new project-owned volumes may be restored");process.exitCode=1;}}});' "$project"
for key in $(compose config --volumes); do
 if docker volume inspect "${project}_${key}" >/dev/null 2>&1; then
  echo 'Restore target volume name already exists' >&2; exit 1
 fi
done
compose create --pull never >/dev/null
trap 'compose stop >/dev/null 2>&1 || true' EXIT
for pair in 'init state /state' 'storage objects /data' 'proxy proxy-data /data'; do
 set -- $pair
 [ -f "$backup/$2.tar" ] || continue
 container=$(compose ps -aq "$1")
 [ -n "$container" ] || { echo 'Required target service missing' >&2; exit 1; }
 volume=$(docker inspect --format "{{range .Mounts}}{{if eq .Destination \"$3\"}}{{.Name}}{{end}}{{end}}" "$container")
 [ -n "$volume" ] || { echo 'Required owned volume missing' >&2; exit 1; }
 docker run --rm -i --platform "$platform" --network none --read-only --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE --security-opt no-new-privileges -v "$volume:/restore" "$app" sh -c 'test -z "$(find /restore -mindepth 1 ! -type d -print -quit)" || { echo "New target volume contains data" >&2; exit 1; }; tar --numeric-owner -xpf - -C /restore' < "$backup/$2.tar"
done
compose up -d --pull never --wait db storage >/dev/null
compose exec -T db pg_restore -U yoyo --no-owner -d yoyo < "$backup/database.dump"
# pg_dump has no optimizer statistics; gather them before serving restored data.
compose exec -T db psql -U yoyo -d yoyo -v ON_ERROR_STOP=1 -c ANALYZE >/dev/null
compose up -d --pull never --wait >/dev/null
trap - EXIT
echo 'Private backup restored to a new project; verify identity, evidence and task state before use.'
