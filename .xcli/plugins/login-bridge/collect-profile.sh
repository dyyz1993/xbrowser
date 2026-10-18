#!/bin/sh
set -eu

# Build a standalone Chromium collector profile from the signed-in Chrome
# profile without copying Chromium-incompatible Chrome Preferences.
SRC="$HOME/Library/Application Support/Google/Chrome/Default"
PROFILE="$HOME/.xbrowser/chrome-collect-profile"
python3 - <<'PY'
import os, shutil
p=os.path.expanduser('~/.xbrowser/chrome-collect-profile')
shutil.rmtree(p, ignore_errors=True)
os.makedirs(p + '/Default', exist_ok=True)
PY
for item in Cookies Cookies-journal "Local Storage" "Session Storage" Network; do
  if [ -e "$SRC/$item" ]; then
    cp -R "$SRC/$item" "$PROFILE/Default/$item"
  fi
done

# Reuse Chrome's major version so BOSS does not observe a full UA migration.
VERSION=$(defaults read "/Applications/Google Chrome.app/Contents/Info" CFBundleShortVersionString 2>/dev/null | cut -d. -f1)
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${VERSION:-139}.0.0.0 Safari/537.36"
LOG="$HOME/.xbrowser/logs/chromium-collect.log"
PIDFILE="$HOME/.xbrowser/chromium-collect.pid"
PORT=${1:-9445}

# Boss collector is write-heavy: naturalize long mouse jumps and pasted text
# into trusted, human-shaped CDP input sequences by default.
export XBROWSER_HUMANIZE_CDP=${XBROWSER_HUMANIZE_CDP:-on}

if curl -fsS "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "collector already running on http://127.0.0.1:$PORT"
  exit 0
fi

mkdir -p "$(dirname "$LOG")"
(
  exec '/Applications/Chromium.app/Contents/MacOS/Chromium' \
    --headless=new \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE" \
    --user-agent="$UA" \
    --no-first-run \
    --no-default-browser-check \
    --disable-session-crashed-bubble \
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding \
    --window-size=1440,900 \
    about:blank
) >"$LOG" 2>&1 &
CANDIDATE=$!
echo "$CANDIDATE" >"$PIDFILE"

for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -fsS "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    if ! kill -0 "$CANDIDATE" 2>/dev/null; then
      RUNNING_PID=$(pgrep -f "Chromium.*--remote-debugging-port=$PORT.*chrome-collect-profile" | head -1 || true)
      if [ -n "$RUNNING_PID" ]; then
        echo "$RUNNING_PID" >"$PIDFILE"
      fi
    fi
    echo "collector ready on http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 0.5
done
echo "collector failed to start; log: $LOG" >&2
exit 1
