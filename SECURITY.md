# Security

This repo is public by intent. It must never hold secrets.

## Never commit

- `auth.json`
- `models-store.json`
- `sessions/`, `tmp/`, `*.log`
- Real `settings.json` / `models.json` with private URLs or keys
- Real `trust.json` with local paths

Only `*.example.json` files are published. Placeholders used:

- `http://YOUR_PROXY_HOST:8317/v1`
- `YOUR_API_KEY_OR_KEY_COMMAND`
- `/path/to/your/project`

## Before every push

```bash
grep -riE "gho_|sk-|api-key|taila0233d|tailscale" --exclude-dir=.git --exclude-dir=pi-tasks . || true
git status --short
```

If the grep hits anything real, stop and sanitize `models.example.json` first.
