#!/bin/sh
set -eu
umask 077
arch=${1:?usage: sh tools/s9/load-release.sh arm64 (from bundle directory)}
case "$arch" in arm64) ;; *) echo 'Only arm64 containers are supported' >&2; exit 1;; esac
if command -v sha256sum >/dev/null 2>&1; then sha256sum -c "images-$arch.sha256"; else shasum -a 256 -c "images-$arch.sha256"; fi
docker load --platform "linux/$arch" -i "images-$arch.tar"
while read -r tag expected; do
  actual=$(docker image inspect --platform "linux/$arch" --format '{{.Id}}' "$tag")
  [ "$actual" = "$expected" ] || { echo 'Image identity mismatch' >&2; exit 1; }
done < "images-$arch.ids"
tag=$(sed -n '1s/ .*//p' "images-$arch.ids")
version=${tag#yoyo-release:}; version=${version%-$arch}
printf 'YOYO_VERSION=%s\nYOYO_ARCH=%s\n' "$version" "$arch" > release.env
echo 'Release images verified; release.env created. Existing instance configuration was not overwritten.'
