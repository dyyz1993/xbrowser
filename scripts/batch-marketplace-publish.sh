#!/usr/bin/env bash
set -euo pipefail

export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890

PLUGINS_DIR=".xcli/plugins"
DRY_RUN=false
START_FROM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --start-from) START_FROM="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

success=()
failed=()
skipped=()
skipping=false
if [[ -n "$START_FROM" ]]; then skipping=true; fi

for dir in $(ls "$PLUGINS_DIR" | sort); do
  # Skip web-automation (too large)
  if [[ "$dir" == "web-automation" ]]; then
    skipped+=("$dir")
    echo "[SKIP] $dir (excluded)"
    continue
  fi

  # Skip until start-from
  if [[ "$skipping" == true ]]; then
    if [[ "$dir" == "$START_FROM" ]]; then
      skipping=false
    else
      skipped+=("$dir")
      echo "[SKIP] $dir (before --start-from)"
      continue
    fi
  fi

  # Check if index.ts exists
  if [[ ! -f "$PLUGINS_DIR/$dir/index.ts" ]]; then
    skipped+=("$dir")
    echo "[SKIP] $dir (no index.ts)"
    continue
  fi

  if $DRY_RUN; then
    echo "[DRY-RUN] $dir"
    npx xbrowser plugin publish "$PLUGINS_DIR/$dir" --dry-run 2>&1 && success+=("$dir") || failed+=("$dir")
  else
    echo "[PUBLISH] $dir"
    if npx xbrowser plugin publish "$PLUGINS_DIR/$dir" 2>&1; then
      success+=("$dir")
      echo "[OK] $dir"
    else
      failed+=("$dir")
      echo "[FAIL] $dir"
    fi
    sleep 2
  fi
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
