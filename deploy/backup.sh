#!/usr/bin/env bash
# The nightly backup (step 14): copies the database into data/backups/, then sends that folder to
# the off-droplet remote named in .env as BACKUP_REMOTE (an rclone remote and bucket, for example
# offsite:planner-backups). Run by planner-backup.timer; safe to run by hand any time.
set -euo pipefail
cd "$(dirname "$0")/.."

remote=$(grep -E '^BACKUP_REMOTE=' .env | tail -n1 | cut -d= -f2- || true)
if [ -z "$remote" ]; then
  echo "backup: add BACKUP_REMOTE=offsite:<bucket> to .env (see DEPLOY.md)." >&2
  exit 1
fi

npm run --silent db:backup
rclone copy data/backups "$remote" --include '*.db'
echo "backup: copied data/backups to $remote"
