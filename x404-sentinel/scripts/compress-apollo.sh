#!/usr/bin/env bash
# Rebuild testdata/apollo11-sstv.webm from the NASA PD source OGV.
# Pass logs stay in a temp directory so the repo root is untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="testdata/src/Apollo_11_Landing_-_first_steps_on_the_moon.ogv"
OUT="testdata/apollo11-sstv.webm"
if [[ ! -f "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
ffmpeg -y -i "$SRC" -ss 40 -t 4 -an \
  -vf "scale=160:120:flags=lanczos,fps=10" \
  -pix_fmt yuv420p \
  -c:v libvpx-vp9 -b:v 150k -pass 1 -deadline good -cpu-used 1 -row-mt 1 -g 40 \
  -passlogfile "$TMP/pass" \
  -f null /dev/null \
  -hide_banner -loglevel error
ffmpeg -y -i "$SRC" -ss 40 -t 4 -an \
  -vf "scale=160:120:flags=lanczos,fps=10" \
  -pix_fmt yuv420p \
  -c:v libvpx-vp9 -b:v 150k -pass 2 -deadline good -cpu-used 1 -row-mt 1 -g 40 \
  -passlogfile "$TMP/pass" \
  "$OUT" \
  -hide_banner -loglevel error
echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
sha256sum "$OUT"
echo "next: go run ./cmd/sentinel -file   then refresh testdata/CATALOG.md if the hash changed"
