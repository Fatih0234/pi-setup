#!/usr/bin/env bash
# Install portable pi setup from this repo into ~/.pi/agent/
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${PI_AGENT_DIR:-$HOME/.pi/agent}"
FORCE=false

if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

copy_file() {
  local src="$1" dest="$2"
  if [[ -f "$dest" && "$FORCE" == "false" ]]; then
    echo "skip (exists, use --force): $dest"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "installed: $dest"
}

copy_dir() {
  local src="$1" dest="$2"
  mkdir -p "$dest"
  cp -r "$src/." "$dest/"
  echo "installed dir: $dest"
}

mkdir -p "$DEST"

copy_file "$SRC/settings.example.json" "$DEST/settings.json"
copy_file "$SRC/models.example.json" "$DEST/models.json"
copy_file "$SRC/mcp.example.json" "$DEST/mcp.json"
copy_file "$SRC/trust.example.json" "$DEST/trust.json"
copy_file "$SRC/keybindings.json" "$DEST/keybindings.json"

copy_dir "$SRC/agents" "$DEST/agents"
copy_dir "$SRC/extensions" "$DEST/extensions"
copy_dir "$SRC/skills" "$DEST/skills"
copy_dir "$SRC/prompts" "$DEST/prompts"

# AGENTS.md lives at ~/.agents/AGENTS.md and is symlinked into ~/.pi/agent/
if [[ -f "$SRC/AGENTS.md" ]]; then
  mkdir -p "$HOME/.agents"
  if [[ ! -e "$HOME/.agents/AGENTS.md" || "$FORCE" == "true" ]]; then
    cp "$SRC/AGENTS.md" "$HOME/.agents/AGENTS.md"
    echo "installed: \$HOME/.agents/AGENTS.md"
  else
    echo "skip (exists, use --force): \$HOME/.agents/AGENTS.md"
  fi
fi

echo ""
echo "Done. Next:"
echo "  1. Edit $DEST/models.json and set your real baseUrl + apiKey."
echo "  2. Restart pi. Packages from settings.json install on startup."
