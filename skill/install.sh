#!/bin/sh
# Install nomo-flowchart-display as the Claude Code skill /visual.
# Usage: skill/install.sh [skills-dir]   (default: ~/.claude/skills)
# Builds the CLI if needed, then copies SKILL.md plus the renderer into <skills-dir>/visual/,
# keeping the layout SKILL.md expects (dist/, assets/, references/ next to it). Needs Node 18.17+.
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
dest="${1:-$HOME/.claude/skills}/visual"
if [ ! -f "$repo/dist/cli.js" ]; then
	(cd "$repo" && npm install && npm run build)
fi
mkdir -p "$dest"
rm -rf "$dest/dist" "$dest/scripts"
cp "$repo/skill/SKILL.md" "$dest/SKILL.md"
cp -R "$repo/dist" "$repo/assets" "$repo/references" "$dest/"
cp "$repo/package.json" "$repo/LICENSE" "$repo/THIRD_PARTY_NOTICES.md" "$dest/"
echo "Installed /visual to $dest"
