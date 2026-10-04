#!/usr/bin/env bash
# npm run deploy (step 14): checks the code, copies it to the droplet, installs and builds there,
# backs up the database, and restarts the app. DEPLOY_HOST in .env says where, for example
# planner@planner.example.com. Only committed code goes out.
set -euo pipefail
cd "$(dirname "$0")/.."

host=$(grep -E '^DEPLOY_HOST=' .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)
if [ -z "$host" ]; then
  echo "deploy: add DEPLOY_HOST=planner@planner.yourdomain.com to .env (see DEPLOY.md)." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "deploy: there are uncommitted changes. Commit them first, so the droplet runs a known version." >&2
  exit 1
fi

npm run check

echo "== Copying $(git rev-parse --short HEAD) to $host"
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude data \
  --exclude .env --exclude '.env.*' --exclude .DS_Store --exclude .claude \
  ./ "$host:notebook-planner/"

ssh "$host" bash -s <<'REMOTE'
set -euo pipefail
cd ~/notebook-planner
echo "== Installing"
# Reinstall only when the package list changed.
sum=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ "$(cat node_modules/.lock-sum 2>/dev/null)" != "$sum" ]; then
  npm ci --no-audit --no-fund
  echo "$sum" > node_modules/.lock-sum
fi
echo "== Building"
npm run build
if ! grep -q '^AUTH_PASSWORD_HASH=' .env 2>/dev/null; then
  echo "deploy: the code is in place, but sign-in isn't set up yet. Finish DEPLOY.md step 6, then run npm run deploy again." >&2
  exit 1
fi
echo "== Backing up the database before it restarts"
npm run --silent db:backup
echo "== Restarting"
sudo systemctl restart planner
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    echo "deploy: the planner is up."
    exit 0
  fi
  sleep 1
done
echo "deploy: the planner didn't come back. Its log: journalctl -u planner -n 50" >&2
exit 1
REMOTE
