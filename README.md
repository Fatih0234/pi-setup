# pi-setup

Portable, public-safe snapshot of my [pi coding agent](https://github.com/badlogic/pi-mono) setup.

Source: `~/.pi/agent/` on my dev machine. Secrets, sessions, logs, and machine paths are excluded by design.

## Layout

| Path | What it is |
|------|------------|
| `AGENTS.md` | Global agent instructions (symlinked from `~/.agents/AGENTS.md` into `~/.pi/agent/`) |
| `settings.example.json` | Copy of `settings.json` without `deviceId`. Lists theme, default model, packages |
| `models.example.json` | Copy of `models.json` with proxy URL and API key replaced by placeholders |
| `mcp.example.json` | Empty MCP server map template |
| `trust.example.json` | Placeholder for trusted project paths |
| `keybindings.json` | Keybindings (safe to copy as-is) |
| `agents/` | 5 custom subagents: Explore, auditor, debugger, implementer, reviewer |
| `extensions/` | `pi-notify.ts`, `split-fork.ts` |
| `skills/web-research/` | Web research skill |
| `prompts/` | `implement.md` issue implementation prompt |
| `docs/PACKAGES.md` | Package list with install source |

## Never published

- `auth.json` (login tokens)
- `models-store.json` (918KB model cache, may hold tokens)
- `sessions/` (conversation history)
- `tmp/`, `*.log` (debug logs)
- `trust.json` real paths (only `.example` is published)
- Real proxy URLs, tailnet hostnames, API keys

See `SECURITY.md` for the sanitize rule.

## Install

```bash
git clone https://github.com/Fatih0234/pi-setup.git
cd pi-setup
./install.sh
```

`install.sh` copies:

- `settings.example.json` -> `~/.pi/agent/settings.json` (does not overwrite existing files by default, use `--force` to overwrite)
- `models.example.json` -> `~/.pi/agent/models.json`
- `agents/`, `extensions/`, `skills/`, `prompts/`, `keybindings.json`, `AGENTS.md`

Then edit `~/.pi/agent/models.json` and set your real `baseUrl` and `apiKey`.

## Update snapshot

Edit files in `~/.pi/agent/`, then copy back the safe parts:

```bash
cp ~/.pi/agent/agents/*.md agents/
cp ~/.pi/agent/extensions/*.ts extensions/
# re-sanitize settings/models, never copy auth.json or sessions/
```

## Packages

Declared in `settings.example.json`:

- `npm:@tintinweb/pi-subagents`
- `git:github.com/obra/superpowers`
- `npm:pi-ask-user`
- `npm:pi-lens`
- `git:github.com/Fatih0234/pi-tasks@v0.9.0-fork.1`

Pi installs these on startup. Details in `docs/PACKAGES.md`.
