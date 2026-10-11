# Packages

Declared in `settings.example.json` under `packages`. Pi installs these on startup.

| Package | Type | Purpose |
|---------|------|---------|
| `npm:@tintinweb/pi-subagents` | npm | Subagent support |
| `git:github.com/obra/superpowers` | git | Superpowers skills (brainstorming, debugging, TDD, planning) |
| `npm:pi-ask-user` | npm | Structured user decision gate |
| `npm:pi-lens` | npm | AST search, LSP navigation, diagnostics |
| `git:github.com/Fatih0234/pi-tasks@v0.9.0-fork.1` | git | Task tracking extension (fork) |

Machine-local `_disabledPackages` entries were stripped from `settings.example.json` (broken relative paths, not portable).

Local npm manifest from the machine (`~/.pi/agent/npm/package.json`) also lists `pi-oracle@^0.7.21` as installed. It is not in `settings.json` packages, so it is documented here only.
