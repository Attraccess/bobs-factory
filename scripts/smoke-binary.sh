#!/usr/bin/env bash
set -euo pipefail
binary="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
smoke_root="$(mktemp -d)"
worker_pid=""
port="${BOBS_FACTORY_SMOKE_PORT:-4397}"
curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1 && { echo "Smoke port already occupied"; exit 1; }
cleanup() { status=$?; if [[ -n "$worker_pid" ]]; then kill -TERM "$worker_pid" 2>/dev/null || true; wait "$worker_pid" 2>/dev/null || true; fi; if [[ "$status" -ne 0 ]]; then echo "Failed smoke retained at $smoke_root"; else rm -rf "$smoke_root"; fi; }
trap cleanup EXIT
mkdir -p "$smoke_root/home" "$smoke_root/repo" "$smoke_root/path"
# Only OS tools and Git are available; no factory Node/Bun/npm executable.
for tool in git ps; do ln -s "$(command -v "$tool")" "$smoke_root/path/$tool"; done
git -C "$smoke_root/repo" init -q -b main
git -C "$smoke_root/repo" -c user.name=Smoke -c user.email=smoke@example.invalid commit -q --allow-empty -m initial
HOME="$smoke_root/home" PATH="$smoke_root/path:/usr/bin:/bin" "$binary" --version
HOME="$smoke_root/home" PATH="$smoke_root/path:/usr/bin:/bin" "$binary" --help >/dev/null
printf '{"allow":["Shell(*)"],"deny":["Shell(rm)"]}' > "$smoke_root/permissions.json"
printf '{"hook_event_name":"beforeShellExecution","command":"rm -rf /tmp/example"}' | HOME="$smoke_root/home" PATH="$smoke_root/path:/usr/bin:/bin" "$binary" internal cursor-permission "$smoke_root/permissions.json" > "$smoke_root/permission.json"
grep -q '"permission":"deny"' "$smoke_root/permission.json"
# Cursor is user-prepared. An unconfigured installation must fail with guidance.
if HOME="$smoke_root/home" PATH="$smoke_root/path:/usr/bin:/bin" BOBS_FACTORY_CURSOR_SDK_PATH="" "$binary" internal cursor-storage "$smoke_root/repo" > "$smoke_root/cursor-missing.log" 2>&1; then
  echo 'Unprepared Cursor unexpectedly succeeded'; exit 1
fi
grep -q BOBS_FACTORY_CURSOR_SDK_PATH "$smoke_root/cursor-missing.log"
for attempt in 1 2; do
  ready=false
  HOME="$smoke_root/home" PATH="$smoke_root/path:/usr/bin:/bin" "$binary" --repo "$smoke_root/repo" --home "$smoke_root/home/state" --port "$port" --agent codex > "$smoke_root/worker.log" 2>&1 &
  worker_pid=$!
  for retry in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:$port/" 2>/dev/null > "$smoke_root/index.html"; then ready=true; break; fi
    kill -0 "$worker_pid" || { cat "$smoke_root/worker.log"; exit 1; }
    sleep 1
  done
  if [[ "$ready" != true ]]; then cat "$smoke_root/worker.log"; exit 1; fi
  curl -fsS http://127.0.0.1:$port/api/config > "$smoke_root/state.json"
  curl -fsS http://127.0.0.1:$port/manifest.webmanifest >/dev/null
  curl -fsS http://127.0.0.1:$port/sw.js >/dev/null
  kill -TERM "$worker_pid"
  wait "$worker_pid"
  worker_pid=""
done
printf '{"ticket":{"id":38}}' > "$smoke_root/input.json"
# MCP server must emit JSON protocol only, including scoped context pagination.
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_context","arguments":{"path":"/ticket"}}}' | HOME="$smoke_root/home" PATH="$smoke_root/path:/usr/bin:/bin" "$binary" internal factory-context "$smoke_root/input.json" > "$smoke_root/mcp.jsonl" &
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
echo 'Binary startup/assets/API/MCP/shutdown/restart smoke passed'
