import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is required for data-retention maintenance");
const base = (process.env.APP_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const response = await fetch(`${base}/api/jobs/retention`, { headers: { authorization: `Bearer ${secret}` } });
if (!response.ok) throw new Error(`Data-retention maintenance failed: HTTP ${response.status}`);
const result = await response.json();
process.stdout.write(`Checked ${result.checkedEvents} events; anonymized ${result.anonymizedRegistrants} registrants in ${result.anonymizedEvents} events.\n`);
