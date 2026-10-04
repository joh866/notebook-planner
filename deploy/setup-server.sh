#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 droplet for the planner (step 14). Run as root:
#   bash /root/planner-deploy/setup-server.sh planner.example.com
# Installs Node, Caddy, and rclone; makes the planner user with your SSH key; turns on the firewall;
# and installs the app, backup, and web server settings. Running it again is safe.
set -euo pipefail

domain=${1:-}
if [ -z "$domain" ]; then
  echo "Usage: bash setup-server.sh planner.yourdomain.com" >&2
  exit 1
fi
here=$(cd "$(dirname "$0")" && pwd)
app=/home/planner/notebook-planner

echo "== Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https \
  build-essential python3 sqlite3 rsync ufw unattended-upgrades rclone

echo "== Node 22"
if ! command -v node >/dev/null || ! node -v | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "== Swap (1 GB), so installing and building fit in memory"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Firewall: SSH and web only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "== The planner user"
if ! id planner >/dev/null 2>&1; then
  adduser --disabled-password --gecos '' planner
fi
install -d -m 700 -o planner -g planner /home/planner/.ssh
install -m 600 -o planner -g planner /root/.ssh/authorized_keys /home/planner/.ssh/authorized_keys
install -d -o planner -g planner "$app" "$app/data"
# The deploy script restarts the app without a password, and nothing else.
echo 'planner ALL=(root) NOPASSWD: /usr/bin/systemctl restart planner' > /etc/sudoers.d/planner
chmod 440 /etc/sudoers.d/planner
visudo -cf /etc/sudoers.d/planner

echo "== App, backup, and web server settings"
install -m 644 "$here/planner.service" /etc/systemd/system/planner.service
install -m 644 "$here/planner-backup.service" /etc/systemd/system/planner-backup.service
install -m 644 "$here/planner-backup.timer" /etc/systemd/system/planner-backup.timer
systemctl daemon-reload
systemctl enable planner
systemctl enable --now planner-backup.timer
sed "s/^DOMAIN {/$domain {/" "$here/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy || systemctl restart caddy

echo
echo "Done. Next: DEPLOY.md, step 5 (the first deploy, from your Mac)."
