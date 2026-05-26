#!/usr/bin/env bash
#
# rebuild-daos-backends.sh — one-command rebuild of the daos backend
# fleet after a change in @omnitron-dev/titan (or any workspace dep
# they bundle through esbuild at spawn time).
#
# Why this exists (T#82): a titan source edit doesn't propagate to
# running backends automatically. The full dance is FOUR steps:
#
#   1. Rebuild titan dist (`tsc` in packages/titan). esbuild reads
#      the dist artefacts when bundling each daos backend at spawn.
#   2. Clear `.omnitron-build/` caches in every daos app. Without
#      this, omnitron's bundler shortcuts to the stale bundle even
#      though titan dist is fresh.
#   3. Restart each backend via `omnitron restart` — that triggers
#      a fresh esbuild bundle into `.omnitron-build/` and respawns
#      the worker with the new code.
#   4. Verify all backends are online.
#
# Missing any one of these (especially #2 — easy to forget) leaves
# the backends running with stale code. T#77 burned an hour
# debugging "T#68 wildcard not active" because dist had a partial
# emit; this script fences off every step.
#
# Usage:
#   scripts/rebuild-daos-backends.sh
#   scripts/rebuild-daos-backends.sh --skip-titan         # skip step 1
#   scripts/rebuild-daos-backends.sh --apps main,storage  # subset

set -euo pipefail

OMNI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DAOS_ROOT="${DAOS_ROOT:-/Users/taaliman/projects/dao/daos}"

# Defaults — all daos backends managed by omnitron.
DEFAULT_APPS="main,storage,priceverse,paysys,messaging"
APPS=""
SKIP_TITAN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-titan) SKIP_TITAN=1; shift ;;
    --apps) APPS="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "[rebuild] unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$APPS" ]]; then APPS="$DEFAULT_APPS"; fi
IFS=',' read -ra APP_LIST <<< "$APPS"

log() {
  # ANSI green for step headers
  printf '\033[1;32m[rebuild]\033[0m %s\n' "$*"
}

err() {
  printf '\033[1;31m[rebuild]\033[0m %s\n' "$*" >&2
}

# --- Step 1: titan dist ---
if [[ $SKIP_TITAN -eq 0 ]]; then
  log "1/4 Rebuilding titan dist..."
  cd "$OMNI_ROOT/packages/titan"
  rm -rf dist node_modules/.tmp
  if ! npx tsc -p ./tsconfig.json; then
    err "titan tsc failed — aborting"
    exit 1
  fi
  # Sanity check — titan exports a known submodule. If this file
  # is missing the bundler will fail at every backend's spawn.
  if [[ ! -f "dist/utils/index.js" ]]; then
    err "titan dist incomplete (dist/utils/index.js missing)"
    exit 1
  fi
  if [[ ! -f "dist/netron/index.js" ]]; then
    err "titan dist incomplete (dist/netron/index.js missing)"
    exit 1
  fi
  log "  → titan dist ready"
else
  log "1/4 [SKIP] titan rebuild (--skip-titan)"
fi

# --- Step 2: clear .omnitron-build caches ---
log "2/4 Clearing .omnitron-build/ caches..."
for app in "${APP_LIST[@]}"; do
  cache="$DAOS_ROOT/apps/$app/.omnitron-build"
  if [[ -d "$cache" ]]; then
    file_count=$(find "$cache" -type f 2>/dev/null | wc -l | tr -d ' ')
    rm -rf "$cache"
    log "  → $app: cleared ($file_count files)"
  else
    log "  → $app: no cache"
  fi
done

# --- Step 3: restart each backend ---
log "3/4 Restarting backends..."
for app in "${APP_LIST[@]}"; do
  full="omni/dev/$app"
  # `omnitron restart` returns 0 even on transient errors — capture
  # the spinner output and check the final line for "online".
  if out=$(omnitron restart "$full" 2>&1); then
    if echo "$out" | grep -q 'online'; then
      log "  → $full: online"
    else
      err "  → $full: restart returned but no 'online' confirmation"
      err "      output: $(echo "$out" | tail -1)"
    fi
  else
    err "  → $full: restart FAILED — see omnitron logs"
  fi
done

# --- Step 4: verify all online ---
log "4/4 Verifying all backends online..."
deadline=$(($(date +%s) + 120))
while [[ $(date +%s) -lt $deadline ]]; do
  online=$(omnitron list --json 2>/dev/null | python3 -c '
import sys, json
try:
  d = json.load(sys.stdin)
  apps = d.get("data", {}).get("apps", [])
  expected = set("omni/dev/" + a for a in sys.argv[1].split(","))
  online = set(a["name"] for a in apps if a["name"] in expected and a["status"] == "online")
  print(len(online), len(expected))
except Exception as e:
  print(0, 0, file=sys.stderr)
' "$APPS" 2>/dev/null)
  read -r got want <<< "$online"
  if [[ "$got" == "$want" && "$got" -gt 0 ]]; then
    log "  → all $got/$want backends online"
    break
  fi
  sleep 3
done

if [[ $(date +%s) -ge $deadline ]]; then
  err "timeout waiting for all backends to come online (got $got/$want)"
  err "run \`omnitron list\` to inspect the failed app(s)"
  exit 1
fi

log "Done."
