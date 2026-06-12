#!/bin/bash
# Recorder E2E Test Suite
# Tests 4 scenarios: iframe, same-tab navigation, new-tab same-origin, new-tab cross-origin
#
# Prerequisites:
#   - npm run build
#   - xbrowser built locally
#   - Chromium at /Applications/Chromium.app/Contents/MacOS/Chromium

set -euo pipefail

XBROWSER_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURES="$XBROWSER_ROOT/tests/recorder/fixtures"
RECORDINGS="$XBROWSER_ROOT/recordings"
XBROWSER="node $XBROWSER_ROOT/dist/cli.js"

PASS=0
FAIL=0
RESULTS=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $*"; }
pass() { echo -e "${GREEN}[PASS]${NC} $*"; RESULTS+=("PASS: $1"); PASS=$((PASS+1)); }
fail() { echo -e "${RED}[FAIL]${NC} $*"; RESULTS+=("FAIL: $1"); FAIL=$((FAIL+1)); }

# ─── Start HTTP servers ─────────────────────────────────────────
log "Starting HTTP servers..."
node "$XBROWSER_ROOT/tests/recorder/serve.mjs" &
SERVE_PID=$!
sleep 1

# Verify servers are up
if ! curl -s http://localhost:3847/page-a.html > /dev/null 2>&1; then
  echo "ERROR: Server A not responding on :3847"
  kill $SERVE_PID 2>/dev/null
  exit 1
fi
log "Servers ready: A=:3847 B=:3848"

# ─── Cleanup ─────────────────────────────────────────────────────
cleanup() {
  log "Cleaning up..."
  $XBROWSER kill 2>/dev/null || true
  kill $SERVE_PID 2>/dev/null || true
  /bin/rm -f ~/.xbrowser/recorder-debug.log 2>/dev/null || true
}
trap cleanup EXIT

# ─── Helper: run a test scenario ─────────────────────────────────
run_test() {
  local test_name="$1"
  local start_url="$2"
  local expected_min_actions="$3"
  local wait_seconds="$4"
  local extra_cmds="${5:-}"

  log "--- Running: $test_name ---"
  log "Start URL: $start_url"
  log "Expected min actions: $expected_min_actions"

  # Clean state
  $XBROWSER kill 2>/dev/null || true
  /bin/rm -f ~/.xbrowser/recorder-debug.log 2>/dev/null || true
  sleep 1

  # Start recording
  $XBROWSER record start --url "$start_url" 2>&1
  sleep 2

  # Execute extra commands (e.g., navigate to page B)
  if [ -n "$extra_cmds" ]; then
    eval "$extra_cmds"
  fi

  # Wait for auto-triggered events
  log "Waiting ${wait_seconds}s for auto-triggered events..."
  sleep "$wait_seconds"

  # Stop recording and capture output
  local stop_output
  stop_output=$($XBROWSER record stop 2>&1)

  # Extract actions count from output
  local actions
  actions=$(echo "$stop_output" | grep "^actions:" | head -1 | awk '{print $2}')
  if [ -z "$actions" ] || [ "$actions" = "" ]; then
    actions="0"
  fi

  # Also show the output for debugging
  echo "$stop_output"

  # Verify
  log "Captured actions: $actions (expected >= $expected_min_actions)"

  if [ "$actions" -ge "$expected_min_actions" ]; then
    pass "$test_name ($actions actions >= $expected_min_actions)"
  else
    fail "$test_name ($actions actions < $expected_min_actions)"
  fi

  # Show debug log if exists
  if [ -f ~/.xbrowser/recorder-debug.log ]; then
    log "Debug log:"
    cat ~/.xbrowser/recorder-debug.log | head -20
  fi
}

# ═══════════════════════════════════════════════════════════════════
# Test 1: IFrame capture (same tab)
# Expected: main button click + iframe button click = 2 actions
# ═══════════════════════════════════════════════════════════════════
run_test "iframe" \
  "http://localhost:3847/iframe-page.html" \
  2 \
  6

# ═══════════════════════════════════════════════════════════════════
# Test 2: Same-tab navigation A → B
# Expected: click on A + navigate + input/click on B = 3 actions
# ═══════════════════════════════════════════════════════════════════
run_test "same-tab-nav" \
  "http://localhost:3847/page-a.html" \
  3 \
  10 \
  "sleep 3 && $XBROWSER eval 'window.location.href=document.querySelector(\"#link-to-b\").href' 2>&1"

# ═══════════════════════════════════════════════════════════════════
# Test 3: New tab same-origin (A opens B in new tab)
# Expected: click on A + click on B (new tab) = 2 actions
# ═══════════════════════════════════════════════════════════════════
run_test "new-tab-same-origin" \
  "http://localhost:3847/page-a.html" \
  2 \
  10 \
  "sleep 3 && $XBROWSER eval 'window.open(\"/page-b.html\")' 2>&1"

# ═══════════════════════════════════════════════════════════════════
# Test 4: New tab cross-origin (A opens C on different port)
# Expected: click on A + click on C (cross-origin tab) = 2 actions
# ═══════════════════════════════════════════════════════════════════
run_test "new-tab-cross-origin" \
  "http://localhost:3847/page-a.html" \
  2 \
  10 \
  "sleep 3 && $XBROWSER eval 'window.open(\"http://localhost:3848/page-c.html\")' 2>&1"

# ─── Summary ─────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Recorder E2E Test Results"
echo "============================================"
for r in "${RESULTS[@]}"; do
  if [[ "$r" == PASS* ]]; then
    echo -e "  ${GREEN}$r${NC}"
  else
    echo -e "  ${RED}$r${NC}"
  fi
done
echo "============================================"
echo -e "  Total: $((PASS+FAIL))  ${GREEN}Pass: $PASS${NC}  ${RED}Fail: $FAIL${NC}"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
