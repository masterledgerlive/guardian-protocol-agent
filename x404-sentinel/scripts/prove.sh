#!/usr/bin/env bash
# Build x404-sentinel, confirm a bare GET is 404, then unlock apollo11-sstv.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "x404-sentinel prove  root=$ROOT"
go test ./...
go build -o /tmp/x404-sentinel ./cmd/sentinel

PORT="${SENTINEL_PORT:-18080}"
LOG="/tmp/x404-sentinel.log"
/tmp/x404-sentinel -addr "127.0.0.1:${PORT}" -root "$ROOT" >"$LOG" 2>&1 &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then
  echo "server did not start" >&2
  cat "$LOG" >&2 || true
  exit 1
fi

body="$(mktemp)"
code="$(curl -s -o "$body" -w "%{http_code}" "http://127.0.0.1:${PORT}/container/apollo11-sstv")"
if [[ "$code" != "404" ]]; then
  echo "expected 404 without proof, got $code" >&2
  cat "$body" >&2
  exit 1
fi
python3 - "$body" << 'PY'
import json, sys
raw = open(sys.argv[1], "rb").read()
if b"\x1a\x45\xdf\xa3" in raw:
    raise SystemExit("404 body contained WebM magic")
doc = json.loads(raw)
assert doc["ok"] is False
assert doc["state"] == "HIDDEN"
assert doc["reason"] == "sealed"
print("404 sealed, no video bytes")
PY

proof="$(/tmp/x404-sentinel -root "$ROOT" -mint apollo11-sstv)"
if [[ "${#proof}" != 896 ]]; then
  echo "seal hex length ${#proof}, want 896" >&2
  exit 1
fi

consent="$(mktemp)"
ccode="$(curl -s -o "$consent" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"apollo11-sstv\",\"proofHex\":\"${proof}\"}" \
  "http://127.0.0.1:${PORT}/consent")"
if [[ "$ccode" != "200" ]]; then
  echo "consent status $ccode" >&2
  cat "$consent" >&2
  exit 1
fi
python3 - "$consent" << 'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
assert doc["ok"] is True and doc["state"] == "HASH_OK", doc
print("consent HASH_OK")
PY

vid="$(mktemp)"
vcode="$(curl -s -o "$vid" -w "%{http_code}" \
  -H "X-Sentinel-Proof: ${proof}" \
  "http://127.0.0.1:${PORT}/container/apollo11-sstv")"
if [[ "$vcode" != "200" ]]; then
  echo "expected 200 with seal, got $vcode" >&2
  exit 1
fi
cmp -s "$vid" testdata/apollo11-sstv.webm
got="$(sha256sum "$vid" | awk '{print $1}')"
want="$(sha256sum testdata/apollo11-sstv.webm | awk '{print $1}')"
if [[ "$got" != "$want" ]]; then
  echo "sha mismatch $got $want" >&2
  exit 1
fi
echo "200 stream sha256=$got bytes=$(wc -c < "$vid")"

last="${proof:895:1}"
if [[ "$last" == "0" ]]; then
  bad="${proof:0:895}1"
else
  bad="${proof:0:895}0"
fi
bcode="$(curl -s -o "$body" -w "%{http_code}" \
  -H "X-Sentinel-Proof: ${bad}" \
  "http://127.0.0.1:${PORT}/container/apollo11-sstv")"
if [[ "$bcode" != "404" ]]; then
  echo "wrong key returned $bcode" >&2
  exit 1
fi
python3 - "$body" << 'PY'
import sys
raw = open(sys.argv[1], "rb").read()
if b"\x1a\x45\xdf\xa3" in raw:
    raise SystemExit("wrong-key body contained WebM magic")
print("wrong key stayed 404")
PY

echo "prove ok"
