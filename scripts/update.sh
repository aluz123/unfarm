#!/bin/zsh
# Daily list refresh: crawl, rebuild the public lists, test, publish.
# Installed as a launchd job by scripts/install-launchd.sh.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
LOG=crawler/raw/update.log
mkdir -p crawler/raw
{
  echo "== $(date -u +%FT%TZ)"
  python3 crawler/crawl.py
  node scripts/build-lists.mjs crawler/raw/posts.json
  node --test tests/*.test.js > /dev/null
  ./scripts/build-extension.sh
  git add data/ extension/data/
  if git diff --cached --quiet; then
    echo "no list changes"
  else
    git commit -q -m "Update farm lists $(date -u +%F)"
    git push -q
    echo "published"
  fi
} >> "$LOG" 2>&1
