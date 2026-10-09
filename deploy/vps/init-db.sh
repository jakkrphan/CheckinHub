#!/usr/bin/env bash
# Run once as root on a fresh VPS. Secrets stay on the VPS; this script never prints them.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

repo=/srv/checkinhub
env_file="$repo/.env.production.local"
expected_origin=https://github.com/jakkrphan/CheckinHub.git

if [ ! -d "$repo/.git" ] || [ "$(runuser -u checkinhub -- git -C "$repo" remote get-url origin)" != "$expected_origin" ]; then
  echo "Stop: /srv/checkinhub is not the expected repository." >&2
  exit 1
fi
if [ -e "$env_file" ]; then
  echo "Stop: production environment file already exists." >&2
  exit 1
fi
mysql -e 'SELECT 1' >/dev/null
if [ -n "$(mysql -Nse "SELECT schema_name FROM information_schema.schemata WHERE schema_name='checkinhub'")" ]; then
  echo "Stop: checkinhub database already exists." >&2
  exit 1
fi
if [ -n "$(mysql -Nse "SELECT user FROM mysql.user WHERE user='checkinhub' AND host='127.0.0.1'")" ]; then
  echo "Stop: checkinhub MySQL user already exists." >&2
  exit 1
fi

umask 077
db_password=$(openssl rand -hex 24)
auth_secret=$(openssl rand -hex 32)
cron_secret=$(openssl rand -hex 32)

mysql <<SQL
CREATE DATABASE checkinhub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'checkinhub'@'127.0.0.1' IDENTIFIED BY '$db_password';
GRANT ALL PRIVILEGES ON checkinhub.* TO 'checkinhub'@'127.0.0.1';
SQL

cat > "$env_file" <<ENV
DATABASE_URL="mysql://checkinhub:$db_password@127.0.0.1:3306/checkinhub"
AUTH_SECRET="$auth_secret"
AUTH_TRUST_HOST="true"
APP_BASE_URL="https://checkinhub.tech"
UPLOAD_DIR="/srv/checkinhub-uploads"
CRON_SECRET="$cron_secret"
ENV
chown checkinhub:checkinhub "$env_file"
chmod 600 "$env_file"
unset db_password auth_secret cron_secret
echo "Database and production environment created."
