#!/usr/bin/env bash
set -euo pipefail
binary="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
build_json="$(dirname "$binary")/build.json"
[[ -f "$build_json" && ! -L "$build_json" ]] || { echo 'Native smoke requires the adjacent build.json'; exit 1; }
# The build identity contains only flat string/boolean fields. Keep this check
# usable with the restricted OS-only PATH, without jq, Node or Bun.
json_scalar() { sed -nE "s/^.*\"$2\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|true|false|null)[[:space:]]*[,}].*$/\\1/p" "$1"; }
check_runtime_identity() {
  local response="$1" identity="$2" field expected actual
  sed -nE 's/^.*"runtime"[[:space:]]*:[[:space:]]*(\{[^{}]*\}).*$/\1/p' "$response" > "$identity"
  [[ -s "$identity" ]] || { echo "Runtime identity missing: $response"; return 1; }
  for field in version commit dirty target resourceDigest; do
    expected="$(json_scalar "$build_json" "$field")"
    actual="$(json_scalar "$identity" "$field")"
    [[ -n "$expected" && "$expected" == "$actual" ]] || { echo "Runtime identity mismatch for $field: $response"; return 1; }
  done
  [[ "$(json_scalar "$identity" packaged)" == true ]] || { echo "Expected packaged runtime identity: $response"; return 1; }
}
smoke_root="$(mktemp -d)"
worker_pid=""
port="${BOBS_FACTORY_SMOKE_PORT:-4397}"
curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1 && { echo "Smoke port already occupied"; exit 1; }
cleanup() { status=$?; if [[ -n "$worker_pid" ]]; then kill -TERM "$worker_pid" 2>/dev/null || true; wait "$worker_pid" 2>/dev/null || true; fi; if [[ "$status" -ne 0 ]]; then echo "Failed smoke retained at $smoke_root"; else rm -rf "$smoke_root"; fi; }
trap cleanup EXIT
mkdir -p "$smoke_root/home" "$smoke_root/repo" "$smoke_root/path" "$smoke_root/empty-capacity"
export BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY="$smoke_root/empty-capacity"
export BOBS_FACTORY_SENTRY_DISABLED=1
# Only OS tools and Git are available; no factory Node/Bun/npm executable.
for tool in git ps; do ln -s "$(command -v "$tool")" "$smoke_root/path/$tool"; done
git -C "$smoke_root/repo" init -q -b main
git -C "$smoke_root/repo" -c user.name=Smoke -c user.email=smoke@example.invalid commit -q --allow-empty -m initial
git -C "$smoke_root/repo" remote add origin https://github.com/example/bobs-factory-smoke.git
PATH="$smoke_root/path:/usr/bin:/bin" "$binary" --home "$smoke_root/home/state" --version
PATH="$smoke_root/path:/usr/bin:/bin" "$binary" --home "$smoke_root/home/state" --help >/dev/null
printf '{"allow":["Shell(*)"],"deny":["Shell(rm)"]}' > "$smoke_root/permissions.json"
printf '{"hook_event_name":"beforeShellExecution","command":"rm -rf /tmp/example"}' | PATH="$smoke_root/path:/usr/bin:/bin" "$binary" internal cursor-permission "$smoke_root/permissions.json" > "$smoke_root/permission.json"
grep -q '"permission":"deny"' "$smoke_root/permission.json"
# Cursor is user-prepared. An unconfigured installation must fail with guidance.
if PATH="$smoke_root/path:/usr/bin:/bin" BOBS_FACTORY_CURSOR_SDK_PATH="" "$binary" internal cursor-storage "$smoke_root/repo" > "$smoke_root/cursor-missing.log" 2>&1; then
  echo 'Unprepared Cursor unexpectedly succeeded'; exit 1
fi
grep -q BOBS_FACTORY_CURSOR_SDK_PATH "$smoke_root/cursor-missing.log"
# Seed a private, expiring session fixture before startup. This smoke exercises
# the real access boundary, without requiring a physical passkey or a JS runtime.
# Passkey ceremonies have separate browser/auth tests; no auth bypass is enabled.
umask 077
mkdir -p "$smoke_root/home/state/factory/auth"
session_token="$(openssl rand -hex 32)"
session_hash="$(printf '%s' "$session_token" | openssl dgst -sha256)"
session_hash="${session_hash##* }"
now_ms="$(date +%s)000"
expires_ms="$((now_ms + 3600000))"
printf '{"version":1,"origins":["http://127.0.0.1:%s","http://localhost:%s"],"user":"smoke","credentials":[{"id":"smoke","origin":"http://127.0.0.1:%s","publicKey":"smoke-fixture","counter":0,"deviceType":"singleDevice","backedUp":false,"label":"Smoke fixture","createdAt":%s,"lastUsedAt":%s}],"sessions":[{"hash":"%s","credential":"smoke","origin":"http://127.0.0.1:%s","expires":%s,"verifiedAt":%s}]}' "$port" "$port" "$port" "$now_ms" "$now_ms" "$session_hash" "$port" "$expires_ms" "$now_ms" > "$smoke_root/home/state/factory/auth/state.json"
for attempt in 1 2; do
  ready=false
  PATH="$smoke_root/path:/usr/bin:/bin" "$binary" --home "$smoke_root/home/state" --port "$port" --no-open > "$smoke_root/worker.log" 2>&1 &
  worker_pid=$!
  for retry in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:$port/" 2>/dev/null > "$smoke_root/index.html"; then ready=true; break; fi
    kill -0 "$worker_pid" || { cat "$smoke_root/worker.log"; exit 1; }
    sleep 1
  done
  if [[ "$ready" != true ]]; then cat "$smoke_root/worker.log"; exit 1; fi
  denied_status="$(curl -sS -o "$smoke_root/unauthenticated.json" -w '%{http_code}' "http://127.0.0.1:$port/api/config")"
  [[ "$denied_status" == 401 ]] || { echo "Expected unauthenticated API denial; got $denied_status"; exit 1; }
  curl -fsS -H "Cookie: factory-local-session=$session_token" "http://127.0.0.1:$port/api/config" > "$smoke_root/state.json"
  grep -q '"onboarding"' "$smoke_root/state.json"
  grep -q '"required":true' "$smoke_root/state.json"
  echo "Startup $attempt: guided setup without an agent; unauthenticated API 401; authenticated API 200"
  curl -fsS "http://127.0.0.1:$((port + 1))/version" > "$smoke_root/version.json"
  curl -fsS -H "Cookie: factory-local-session=$session_token" "http://127.0.0.1:$port/api/version" > "$smoke_root/api-version.json"
  check_runtime_identity "$smoke_root/version.json" "$smoke_root/version-identity.json"
  check_runtime_identity "$smoke_root/api-version.json" "$smoke_root/api-version-identity.json"
  echo "Startup $attempt: runtime identity matches build.json on /version and /api/version"
  curl -fsS http://127.0.0.1:$port/manifest.webmanifest >/dev/null
  curl -fsS http://127.0.0.1:$port/sw.js >/dev/null
  kill -TERM "$worker_pid"
  wait "$worker_pid"
  worker_pid=""
done
# An explicitly selected project must not pretend an unavailable agent is ready.
if PATH="$smoke_root/path:/usr/bin:/bin" "$binary" --repo "$smoke_root/repo" --home "$smoke_root/home/state" --port "$port" --agent codex --no-open > "$smoke_root/missing-agent.log" 2>&1; then
  echo 'Explicit unavailable agent unexpectedly succeeded'; exit 1
fi
grep -q 'Install the selected codex coding agent' "$smoke_root/missing-agent.log"
printf '{"ticket":{"id":38}}' > "$smoke_root/input.json"
# MCP server must emit JSON protocol only, including scoped context pagination.
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_context","arguments":{"path":"/ticket"}}}' | PATH="$smoke_root/path:/usr/bin:/bin" "$binary" internal factory-context "$smoke_root/input.json" > "$smoke_root/mcp.jsonl" &
helper_pid=$!
for retry in $(seq 1 60); do
  if grep -q totalCharacters "$smoke_root/mcp.jsonl"; then break; fi
  kill -0 "$helper_pid" 2>/dev/null || break
  sleep 1
done
kill -TERM "$helper_pid" 2>/dev/null || true
wait "$helper_pid" 2>/dev/null || true
# OS grep, not a JavaScript runtime, validates protocol output.
grep -q '"jsonrpc":"2.0"' "$smoke_root/mcp.jsonl"
grep -q 'totalCharacters' "$smoke_root/mcp.jsonl"
echo 'Binary startup/assets/protected API/MCP/shutdown/restart smoke passed'
