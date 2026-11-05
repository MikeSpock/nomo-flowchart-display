#!/bin/sh
# Install nomo-flowchart-display as the Claude Code skill /visual.
# Usage: skill/install.sh [skills-dir]   (default: ~/.claude/skills)
# Copies SKILL.md plus the renderer into <skills-dir>/visual/, keeping the
# layout SKILL.md expects (scripts/, assets/, references/ next to it).
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
dest="${1:-$HOME/.claude/skills}/visual"
mkdir -p "$dest"
cp "$repo/skill/SKILL.md" "$dest/SKILL.md"
cp -R "$repo/scripts" "$repo/assets" "$repo/references" "$dest/"
cp "$repo/LICENSE" "$repo/THIRD_PARTY_NOTICES.md" "$dest/"
echo "Installed /visual to $dest"
