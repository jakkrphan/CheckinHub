# CheckInHub on one Ubuntu VPS

These templates use a single Next.js process on `127.0.0.1:3100`, nginx for HTTPS at `checkinhub.tech`, a private MySQL database, and a private persistent upload directory. Keep staging on a separate database and upload directory.

## Prerequisites

- A Hostinger VPS running Ubuntu; the A record for `checkinhub.tech` must point to `201.18.219.134`. The current AAAA record `2a02:4780:5e:a187::1` matches the VPS hostname's IPv6 address. `www` may be a CNAME to `checkinhub.tech`. Leave MX/TXT records used by email alone.
- Ubuntu 26.04 packages for Node.js 22, npm, nginx, MySQL 8.4, and Certbot with its nginx plugin.
- A dedicated Linux account `checkinhub`. Only SSH and HTTP/HTTPS should be reachable from the internet; MySQL and port 3100 stay private.
- A checked out copy of this repository at `/srv/checkinhub`, owned by `checkinhub`.

On a fresh Ubuntu 26.04 VPS, install the packages as root:

```sh
apt-get update
apt-get install -y nodejs npm mysql-server nginx certbot python3-certbot-nginx git
node --version && npm --version && mysql --version
```

On a fresh VPS, create the service account, check out the public repository, and prepare private storage:

```sh
id checkinhub >/dev/null 2>&1 || useradd --system --user-group --home-dir /srv/checkinhub --shell /usr/sbin/nologin checkinhub
git clone https://github.com/jakkrphan/CheckinHub.git /srv/checkinhub
chown -R checkinhub:checkinhub /srv/checkinhub
install -d -o checkinhub -g checkinhub -m 700 /srv/checkinhub-uploads
systemctl enable --now nginx
```

If `/srv/checkinhub` already exists, inspect it before cloning or changing ownership. Never run the local `db:seed` script on this server.

## Data and secrets

Create a production database and a dedicated MySQL user with a strong password. Do not use the passwords from `compose.yaml`, which is for local development. Create `/srv/checkinhub-uploads` owned by `checkinhub` with mode `0700`. On a fresh installation, run `bash deploy/vps/init-db.sh` as root after cloning; it checks for an existing database and env file, generates private secrets on the VPS, and writes `.env.production.local` with mode `0600`. It stops if either already exists.

The generated `/srv/checkinhub/.env.production.local` contains at least:

```dotenv
DATABASE_URL="mysql://USER:PASSWORD@127.0.0.1:3306/checkinhub"
AUTH_SECRET="RANDOM_VALUE_AT_LEAST_32_BYTES"
AUTH_TRUST_HOST="true"
APP_BASE_URL="https://checkinhub.tech"
UPLOAD_DIR="/srv/checkinhub-uploads"
CRON_SECRET="ANOTHER_LONG_RANDOM_VALUE"
NEXT_PUBLIC_TURNSTILE_SITE_KEY="REAL_SITE_KEY"
TURNSTILE_SECRET_KEY="REAL_SECRET_KEY"
```

Use URL encoding for special characters in the MySQL password inside `DATABASE_URL`. Set the SMTP variables if email notifications are needed and the LINE variables if LINE is enabled. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` must be present **before** `npm run build`. The retention job also removes this database's tracked orphan uploads; keep production and staging storage separate.

## Install and start

Run these commands as `checkinhub` from `/srv/checkinhub`. Set `NODE_ENV=production` so Prisma reads `.env.production.local`:

```sh
npm ci
NODE_ENV=production npx prisma generate
NODE_ENV=production npx prisma migrate deploy
NODE_ENV=production npm run build
```

For the first installation, set `CHECKIN_ADMIN_NAME`, `CHECKIN_ADMIN_EMAIL`, and `CHECKIN_ADMIN_PASSWORD` (12 or more characters) for one invocation of `npm run admin:create`. Do not run `db:seed` on production.

Copy `checkinhub.service` to `/etc/systemd/system/checkinhub.service`, then run `systemctl daemon-reload`, `systemctl enable --now checkinhub`, and check `systemctl status checkinhub`. Verify `http://127.0.0.1:3100/api/health` on the VPS returns `database: ok`.

Copy `nginx.conf.example` to `/etc/nginx/sites-available/checkinhub`, enable the site, and run `nginx -t` before reloading nginx. Once DNS points to the VPS, obtain and install the certificate with `certbot --nginx -d checkinhub.tech -d www.checkinhub.tech`. The app's rate limits require nginx to **replace**, rather than append to, `X-Forwarded-For`; the included config does this.

## Scheduled jobs

Install these in `checkinhub`'s crontab. The scripts read `.env.production.local` and call the app using `APP_BASE_URL` and `CRON_SECRET`:

```cron
*/15 * * * * cd /srv/checkinhub && NODE_ENV=production /usr/bin/npm run -s maintenance:pending-holds
*/5 * * * * cd /srv/checkinhub && NODE_ENV=production /usr/bin/npm run -s maintenance:notifications
30 2 * * * cd /srv/checkinhub && NODE_ENV=production /usr/bin/npm run -s maintenance:retention
```

Back up both MySQL and `/srv/checkinhub-uploads` on a schedule, keep backups outside the VPS, and practice restoring them together. Monitor `/api/health`, `journalctl -u checkinhub`, and cron failures. Run `NODE_ENV=production npx prisma migrate deploy` on each application update before restarting the service.
