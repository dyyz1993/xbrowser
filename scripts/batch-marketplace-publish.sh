#!/usr/bin/env bash
set -euo pipefail

export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890

PLUGINS_DIR=".xcli/plugins"
EXCLUDE=("web-automation")
DRY_RUN=false
START_FROM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --start-from) START_FROM="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

EXCLUDE_PATTERN=""
for name in "${EXCLUDE[@]}"; do
  EXCLUDE_PATTERN+=" -not -name '$name'"
done

mapfile -t PLUGINS < <(eval "find '$PLUGINS_DIR' -maxdepth 1 -mindepth 1 -type d $EXCLUDE_PATTERN -exec basename {} \;" | sort)

skipping=$([[ -n "$START_FROM" ]] && echo true || echo false)

success=()
failed=()
skipped=()

for dir in "${PLUGINS[@]}"; do
  if [[ "$skipping" == true ]]; then
    if [[ "$dir" == "$START_FROM" ]]; then
      skipping=false
    else
      skipped+=("$dir")
      echo "[SKIP] $dir (before --start-from)"
      continue
    fi
  fi

  cmd="npx xbrowser plugin publish \"$PLUGINS_DIR/$dir\""
  if $DRY_RUN; then
    cmd+=" --dry-run"
  fi

  echo "[PUBLISH] $dir"
  if eval "$cmd"; then
    success+=("$dir")
    echo "[OK] $dir"
  else
    failed+=("$dir")
    echo "[FAIL] $dir"
  fi

  sleep 2
done

echo ""
echo "===== Summary ====="
echo "Succeeded: ${#success[@]}"
for p in "${success[@]}"; do echo "  + $p"; done
echo "Failed:    ${#failed[@]}"
for p in "${failed[@]}"; do echo "  - $p"; done
echo "Skipped:   ${#skipped[@]}"
for p in "${skipped[@]}"; do echo "  ~ $p"; done
echo "==================="

if [[ ${#failed[@]} -gt 0 ]]; then
  exit 1
fi
