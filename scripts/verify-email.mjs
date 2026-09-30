// Verify DNS/TLS/SMTP authentication only. This never sends a message.
import nextEnv from "@next/env";
import nodemailer from "nodemailer";
import { smtpConfig, smtpFailure, emailOrigin } from "../src/server/email/client.ts";

nextEnv.loadEnvConfig(process.cwd());
const config = smtpConfig();
if (!config) {
  console.error("SMTP configuration is incomplete or invalid. Check SMTP_HOST/PORT/SECURE/USER/PASS/FROM in .env.local.");
  process.exitCode = 1;
} else {
  const transport = nodemailer.createTransport(config.options);
  try {
    await transport.verify();
    console.log("SMTP connection, TLS and authentication verified. No email was sent.");
    console.log(emailOrigin() ? "Status-link origin is configured (localhost:3100 by default in development)." : "Set APP_BASE_URL to the application's HTTPS origin before sending on production.");
  } catch (error) {
    const failure = smtpFailure(error);
    console.error(`SMTP verification failed: ${failure.ok ? "unknown" : failure.error}`);
    process.exitCode = 1;
  } finally { transport.close(); }
}
