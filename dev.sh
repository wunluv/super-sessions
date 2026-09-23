#!/bin/bash
# dev.sh — keep the live extension path pointed at this repo.
#
# Usage: ./dev.sh            check and repair the symlink
#        ./dev.sh --check    report only, exit 1 if wrong
#
# The extension is developed in this repo and loaded by pi from
# ~/.pi/agent/extensions/super-sessions. That path must be a SYMLINK here.
#
# It used to be a copy, refreshed by this script. Two things went wrong with
# that: the copy diverged from the source (twice, silently, the second time
# costing a day of friction-audit work), and this script only copied *.ts and
# prompts/*.md, so running it would have dropped paths.ts, scripts/, pi-prompts/
# and the spec while overwriting edited sources with older ones. One source of
# truth, no copy step.

set -euo pipefail

SRC="$(cd "$(dirname "$0")/extensions/super-sessions" && pwd)"
DEST="$HOME/.pi/agent/extensions/super-sessions"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

if [ -L "$DEST" ] && [ "$(readlink -f "$DEST")" = "$SRC" ]; then
  echo "✅ $DEST -> $SRC"
  exit 0
fi

if [ -e "$DEST" ]; then
  echo "❌ $DEST is not a symlink to this repo"
  if [ -L "$DEST" ]; then
    echo "   it points at: $(readlink -f "$DEST" 2>/dev/null || echo '(broken)')"
  else
    echo "   it is a real directory (the old copy-based layout)"
  fi
else
  echo "❌ $DEST does not exist"
fi

if [ "$CHECK_ONLY" = 1 ]; then
  exit 1
fi

if [ -e "$DEST" ]; then
  BK="$HOME/.pi/agent/tmp/live-super-sessions-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$(dirname "$BK")"
  mv "$DEST" "$BK"
  echo "   moved the old path to $BK (delete it once pi loads cleanly)"
fi

mkdir -p "$(dirname "$DEST")"
ln -s "$SRC" "$DEST"
echo "✅ linked $DEST -> $SRC"
echo "   run /reload in pi, or start pi."
