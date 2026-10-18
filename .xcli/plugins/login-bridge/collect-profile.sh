#!/bin/sh
set -eu

# Build a standalone Chromium collector profile from the signed-in Chrome
# profile without copying Chromium-incompatible Chrome Preferences.
PORT=${1:-9445}
PROFILE=${XBROWSER_COLLECT_PROFILE:-"$HOME/.xbrowser/chrome-collect-profile"}
SRC="${XBROWSER_COLLECT_SOURCE:-$HOME/Library/Application Support/Google/Chrome/Default}"
LOG="$HOME/.xbrowser/logs/chromium-collect-$PORT.log"
PIDFILE="$HOME/.xbrowser/chromium-collect-$PORT.pid"
LOCKFILE="$PROFILE/SingletonLock"
CHROMIUM_BIN="${XBROWSER_CHROMIUM_BIN:-/Applications/Chromium.app/Contents/MacOS/Chromium}"

profile_pids() {
  escaped_profile=$(printf '%s\n' "$PROFILE" | sed 's/[][\.*^$()+?{}|]/\\&/g')
  pgrep -f "Chromium.*--user-data-dir=${escaped_profile}( |$)" 2>/dev/null || true
}

is_our_collector() {
  pid="$1"
  escaped_profile=$(printf '%s\n' "$PROFILE" | sed 's/[][\.*^$()+?{}|]/\\&/g')
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -E -- "--remote-debugging-port=${PORT}( |$)" >/dev/null &&
    ps -p "$pid" -o command= | grep -E -- "--user-data-dir=${escaped_profile}( |$)" >/dev/null
}

endpoint_pid() {
  curl -fsS --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || return 1
  listener_pid
}

listener_pid() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $2; exit }'
}

# Any listener is a hard ownership gate. A non-CDP HTTP server must not allow
# this launcher to repair or overwrite the profile.
if existing_pid=$(listener_pid) && [ -n "$existing_pid" ]; then
  if ! endpoint_pid >/dev/null 2>&1; then
    echo "port $PORT is owned by another process (pid=$existing_pid)" >&2
    exit 1
  fi
fi

if existing_pid=$(endpoint_pid); then
  if is_our_collector "$existing_pid"; then
    echo "$existing_pid" >"$PIDFILE"
    echo "collector already running on http://127.0.0.1:$PORT (pid=$existing_pid)"
    trap - EXIT INT TERM
    exit 0
  fi
  echo "port $PORT is owned by another process (pid=$existing_pid)" >&2
  exit 1
fi

# Chromium names this lock `<hostname>-<pid>`. Treat any live browser PID from
# that symlink as active even when the CDP port is temporarily unavailable.
if [ -e "$LOCKFILE" ] || [ -L "$LOCKFILE" ]; then
  lock_pid=$(readlink "$LOCKFILE" 2>/dev/null | sed -n 's/.*-\([0-9][0-9]*\)$/\1/p')
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "collector profile is still active (pid=$lock_pid)" >&2
    exit 1
  fi
fi

# Profile ownership is independent of lock presence: Chromium may be starting,
# serving another debugging port, or have temporarily dropped the symlink.
for profile_pid in $(profile_pids); do
  if kill -0 "$profile_pid" 2>/dev/null; then
    echo "collector profile is still active (pid=$profile_pid)" >&2
    exit 1
  fi
done
if [ -e "$LOCKFILE" ] || [ -L "$LOCKFILE" ]; then
  rm -f "$LOCKFILE"
fi

# Rebuild only after the old collector is gone. Missing source items are
# expected on first run; a failed copy fails the launch instead of being hidden.
mkdir -p "$PROFILE/Default" "$(dirname "$LOG")"
for item in Cookies Cookies-journal "Local Storage" "Session Storage" Network; do
  if [ -e "$SRC/$item" ]; then
    cp -R "$SRC/$item" "$PROFILE/Default/$item"
  fi
done

# Reuse Chrome's major version so BOSS does not observe a full UA migration.
VERSION=$(defaults read "/Applications/Google Chrome.app/Contents/Info" CFBundleShortVersionString 2>/dev/null | cut -d. -f1)
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${VERSION:-139}.0.0.0 Safari/537.36"

# Boss collector is write-heavy: naturalize long mouse jumps and pasted text
# into trusted, human-shaped CDP input sequences by default.
export XBROWSER_HUMANIZE_CDP=${XBROWSER_HUMANIZE_CDP:-on}
CANDIDATE=$(/usr/bin/python3 "$(dirname "$0")/launch-collector.py" "$PORT" "$PROFILE" "$CHROMIUM_BIN" "$UA" "$LOG")
echo "$CANDIDATE" >"$PIDFILE"

cleanup_started_collector() {
  [ -n "$CANDIDATE" ] || return 0
  kill -0 "$CANDIDATE" 2>/dev/null || return 0
  command_line=$(ps -p "$CANDIDATE" -o command= 2>/dev/null || true)
  printf '%s\n' "$command_line" | grep -E -- "--remote-debugging-port=${PORT}( |$)" >/dev/null || return 0
  printf '%s\n' "$command_line" | grep -E -- "--user-data-dir=${escaped_profile}( |$)" >/dev/null || return 0
  kill "$CANDIDATE" 2>/dev/null || true
}
trap cleanup_started_collector EXIT INT TERM

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if ready_pid=$(endpoint_pid); then
    if is_our_collector "$ready_pid"; then
      echo "$ready_pid" >"$PIDFILE"
      echo "collector ready on http://127.0.0.1:$PORT (pid=$ready_pid)"
      trap - EXIT INT TERM
      exit 0
    fi
    echo "port $PORT was taken by another process (pid=$ready_pid)" >&2
    exit 1
  fi
  sleep 0.5
done

echo "collector failed to start; log: $LOG" >&2
exit 1
