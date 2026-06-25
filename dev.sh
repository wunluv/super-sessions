#!/bin/bash
# Development convenience script — copies extension to auto-discovery path
# Usage: ./dev.sh

set -e

SRC="$(dirname "$0")/extensions/super-sessions"
DEST="$HOME/.pi/agent/extensions/super-sessions"

echo "Copying extension files..."
mkdir -p "$DEST"
cp "$SRC"/*.ts "$DEST/"
echo "  TypeScript files copied"
if [ -d "$SRC/prompts" ]; then
  mkdir -p "$DEST/prompts"
  cp "$SRC/prompts"/*.md "$DEST/prompts/"
  echo "  Prompts copied"
fi
echo "✅ Extension copied to $DEST"
echo ""
echo "Run 'pi' to start with the extension loaded."
echo "After making changes, run './dev.sh' then /reload in pi."
