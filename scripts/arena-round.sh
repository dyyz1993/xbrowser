#!/bin/bash
cd /Users/xuyingzhou/Project/study-node-ts/xbrowser
npx vitest run tests/arena/arena.test.ts --reporter=json 2>&1 | tail -1 > /tmp/arena-latest.json
# git commit if changes
if [ -n "$(git status --porcelain output/arena/ 2>/dev/null)" ]; then
  git add output/arena/
  git commit -m "arena: auto-round $(date +%Y%m%d-%H%M%S)"
  git push origin master 2>/dev/null
fi
