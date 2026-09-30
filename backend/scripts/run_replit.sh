#!/usr/bin/env bash
# Reserved VM: keep both the public API and its job worker alive.
set -euo pipefail
cd "$(dirname "$0")/.."
export ORBIT_ENVIRONMENT=production
# The native app does not need browser CORS. Explicit origins can override this.
export ORBIT_CORS_ORIGINS="${ORBIT_CORS_ORIGINS:-[]}"
: "${PORT:?The hosting platform must set PORT}"

python -m app.worker &
worker_pid=$!
uvicorn app.main:app --host 0.0.0.0 --port "$PORT" &
api_pid=$!

cleanup() {
  trap - EXIT TERM INT
  kill -TERM "$worker_pid" "$api_pid" 2>/dev/null || true
  wait "$worker_pid" "$api_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Do not silently serve an API whose background analysis has stopped (or vice versa).
wait -n "$worker_pid" "$api_pid" || true
echo "Orbit API or worker stopped unexpectedly." >&2
exit 1