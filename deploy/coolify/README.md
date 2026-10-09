# Deploy CheckInHub with Coolify

This Compose stack runs the Next.js app, a private MySQL 8.4 database, and persistent upload storage. Next.js uses the standalone Node server documented for Docker deployments. Node 24 is used because the current QR scanner dependency requires Node 24 or newer.

## Create the Coolify application

Create a **Docker Compose from Git** application with:

- Repository: `https://github.com/jakkrphan/CheckinHub.git`
- Branch: `main`
- Base directory: `/`
- Compose file: `deploy/coolify/compose.yaml`
- Compose deployment: normal Coolify mode, not Raw

The app service exposes container port `3000`. In the application's Domains settings, add `https://checkinhub.tech:3000` and, if desired, `https://www.checkinhub.tech:3000`, both targeting service `app`. Coolify's proxy handles public HTTPS; do not publish MySQL or the app port on the host.

Point the domain's A record to the current VPS IPv4 address. Add an AAAA record only if the VPS's current IPv6 address is reachable. Keep mail-related MX/TXT records. Make sure the VPS firewall allows inbound ports 80 and 443 for Coolify's proxy.

## Environment variables

Coolify generates the MySQL username/password, `AUTH_SECRET`, and `CRON_SECRET` from the `SERVICE_*` variables in the Compose file. Keep those values in Coolify and do not rotate them casually: changing the database credentials disconnects the app, and changing `AUTH_SECRET` invalidates existing login/status tokens.

Set these values in the application's Environment Variables before the first deployment:

| Variable | Required value |
| --- | --- |
| `APP_BASE_URL` | `https://checkinhub.tech` |

SMTP, LINE, and LDAP variables are optional and are already wired into the Compose definition. When using AD, use LDAPS or StartTLS, make sure the VPS can reach the directory, and set the LDAP bind account values. Leave `LDAP_AUTO_PROVISION=false` unless automatic creation of organizer accounts is intended.

The MySQL database and uploaded files are stored in the Compose volumes `mysql_data` and `uploads`. Preserve both across deployments. Persistent volumes are not backups; configure backups to storage outside this VPS.

## First admin account

After the first deployment is healthy, temporarily add `CHECKIN_ADMIN_NAME`, `CHECKIN_ADMIN_EMAIL`, and `CHECKIN_ADMIN_PASSWORD` to the app's runtime environment in Coolify. Mark the password as secret, use at least 12 characters, then open the app container's Terminal and run:

```sh
node scripts/create-admin.mjs
```

Remove the three temporary variables and redeploy. If the admin will sign in through AD, use that account's exact UPN as `CHECKIN_ADMIN_EMAIL`; its first successful AD login links the directory identity to the admin account.

## Scheduled jobs

Add these tasks under the app's **Scheduled Tasks** page. Run each in the `app` container with a timeout of 300 seconds:

| Command | Schedule |
| --- | --- |
| `node scripts/run-pending-holds.mjs` | `*/15 * * * *` |
| `node scripts/run-notifications.mjs` | `*/5 * * * *` |
| `node scripts/run-retention.mjs` | `30 2 * * *` |

Configure the Coolify server timezone to the timezone intended for the daily retention run. Review each task's first execution in Coolify before relying on its schedule.
