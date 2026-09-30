import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";

import { Client, InvalidCredentialsError, escapeFilter } from "ldapts";

/**
 * Staff sign-in against Active Directory / LDAP. The directory only proves who the person is at login; role,
 * isActive and event membership stay in our User table (docs/ARCHITECTURE.md "ข้อควรทำตอนเปลี่ยนเป็น LDAP").
 */

export type LdapConfig = {
  url: string;
  baseDN: string;
  bindDN: string;
  bindPassword: string;
  /** `{{username}}` is replaced by the RFC 4515-escaped login name. */
  searchFilter: string;
  /** Only entries under this OU may sign in (e.g. "rpp-user"); empty = any entry the filter finds. */
  requiredOu: string;
  startTLS: boolean;
  tlsOptions: ConnectionOptions;
  timeout: number;
  connectTimeout: number;
  autoProvision: boolean;
};

export type LdapIdentity = { guid: string; email: string; name: string };

export type LdapResult =
  | { ok: true; identity: LdapIdentity }
  | { ok: false; code: "INVALID_CREDENTIALS" | "ACCOUNT_DISABLED" | "NOT_AUTHORIZED" | "UNAVAILABLE" };

const DEFAULT_FILTER = "(&(objectCategory=person)(objectClass=user)(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}})))";
const ATTRIBUTES = ["objectGUID", "sAMAccountName", "userPrincipalName", "displayName", "cn", "userAccountControl"];
const ADS_UF_ACCOUNTDISABLE = 0x2;

const positiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** LDAP is on when LDAP_URL is set; the other connection settings are then required. */
export function ldapConfig(env: NodeJS.ProcessEnv = process.env): LdapConfig | null {
  const url = env.LDAP_URL?.trim();
  if (!url) return null;
  const baseDN = env.LDAP_BASE_DN?.trim();
  const bindDN = env.LDAP_BIND_DN?.trim();
  const bindPassword = env.LDAP_BIND_PASSWORD;
  if (!baseDN || !bindDN || !bindPassword) throw new Error("LDAP_URL is set but LDAP_BASE_DN, LDAP_BIND_DN or LDAP_BIND_PASSWORD is missing");

  const tlsOptions: ConnectionOptions = { rejectUnauthorized: env.LDAP_TLS_REJECT_UNAUTHORIZED !== "false" };
  if (env.LDAP_TLS_CA_FILE) tlsOptions.ca = [readFileSync(env.LDAP_TLS_CA_FILE)];

  return {
    url,
    baseDN,
    bindDN,
    bindPassword,
    searchFilter: env.LDAP_SEARCH_FILTER?.trim() || DEFAULT_FILTER,
    requiredOu: env.LDAP_REQUIRED_OU?.trim() ?? "",
    startTLS: env.LDAP_STARTTLS === "true",
    tlsOptions,
    timeout: positiveInt(env.LDAP_TIMEOUT, 5000),
    connectTimeout: positiveInt(env.LDAP_CONNECT_TIMEOUT, 5000),
    autoProvision: env.LDAP_AUTO_PROVISION === "true",
  };
}

export const ldapEnabled = () => !!process.env.LDAP_URL?.trim();

/** Substitutes the login name into the filter template, escaped so `*`, `(`, `)` or `\` cannot change the query. */
export function buildUserFilter(template: string, username: string) {
  const escaped = escapeFilter`${username}`;
  return template.replace(/\{\{username\}\}/g, () => escaped);
}

/** Active Directory stores objectGUID with the first three groups little-endian. */
export function guidFromBuffer(buffer: Buffer) {
  if (buffer.length !== 16) return null;
  const h = (index: number) => buffer[index]!.toString(16).padStart(2, "0");
  return `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}

export function isAccountDisabled(userAccountControl: string | undefined) {
  const flags = Number.parseInt(userAccountControl ?? "", 10);
  return Number.isFinite(flags) && (flags & ADS_UF_ACCOUNTDISABLE) === ADS_UF_ACCOUNTDISABLE;
}

/** Matches a whole `OU=<name>` component of the DN, not a substring of another value. */
export function isUnderOu(dn: string, ou: string) {
  if (!ou) return true;
  const name = ou.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|,)\\s*OU=${name}\\s*(,|$)`, "i").test(dn);
}

const first = (value: unknown): string | Buffer | undefined => Array.isArray(value) ? value[0] : value as string | Buffer | undefined;
const text = (value: unknown) => {
  const item = first(value);
  return item === undefined ? "" : Buffer.isBuffer(item) ? item.toString("utf8") : String(item);
};

const isUnavailable = (error: unknown) => !(error instanceof InvalidCredentialsError);

function client(config: LdapConfig) {
  // ldapts negotiates TLS whenever tlsOptions is given, even for ldap:// — AD then resets the plain connection.
  // StartTLS gets the options through startTLS() instead.
  const secure = config.url.toLowerCase().startsWith("ldaps://");
  return new Client({ url: config.url, timeout: config.timeout, connectTimeout: config.connectTimeout, ...(secure ? { tlsOptions: config.tlsOptions } : {}) });
}

async function open(config: LdapConfig) {
  const connection = client(config);
  if (config.startTLS) await connection.startTLS(config.tlsOptions);
  return connection;
}

async function close(connection: Client) {
  try { await connection.unbind(); } catch { /* already closed */ }
}

/**
 * Looks the user up with the service account, binds once as that DN, then checks the entry may sign in. Only one
 * user bind is attempted so a wrong password counts as a single bad attempt towards the AD lockout policy.
 * Logs carry result codes only, never the login name (PDPA).
 */
export async function authenticateLdap(config: LdapConfig, username: string, password: string): Promise<LdapResult> {
  // An empty password would be an unauthenticated bind, which many servers accept as success.
  if (!username || !password) return { ok: false, code: "INVALID_CREDENTIALS" };

  let entry: Record<string, unknown>;
  const service = await open(config).catch((error) => { console.error("LDAP connect failed:", (error as Error)?.name, (error as Error)?.message); return null; });
  if (!service) return { ok: false, code: "UNAVAILABLE" };
  try {
    await service.bind(config.bindDN, config.bindPassword);
    const { searchEntries } = await service.search(config.baseDN, {
      scope: "sub",
      filter: buildUserFilter(config.searchFilter, username),
      attributes: ATTRIBUTES,
      explicitBufferAttributes: ["objectGUID"],
    });
    // No match and an ambiguous match are both refused the same way.
    if (searchEntries.length !== 1) return { ok: false, code: "INVALID_CREDENTIALS" };
    entry = searchEntries[0]!;
  } catch (error) {
    console.error("LDAP lookup failed:", (error as Error)?.name, (error as Error)?.message);
    return { ok: false, code: "UNAVAILABLE" };
  } finally {
    await close(service);
  }

  const dn = String(entry.dn);
  // Disabled accounts also fail the bind in AD; the entry checks run after it so only the password holder learns them.
  const userClient = await open(config).catch(() => null);
  if (!userClient) return { ok: false, code: "UNAVAILABLE" };
  try {
    await userClient.bind(dn, password);
  } catch (error) {
    if (isUnavailable(error)) {
      console.error("LDAP user bind failed:", (error as Error)?.name, (error as Error)?.message);
      return { ok: false, code: "UNAVAILABLE" };
    }
    return { ok: false, code: "INVALID_CREDENTIALS" };
  } finally {
    await close(userClient);
  }

  if (isAccountDisabled(text(entry.userAccountControl))) return { ok: false, code: "ACCOUNT_DISABLED" };
  if (!isUnderOu(dn, config.requiredOu)) return { ok: false, code: "NOT_AUTHORIZED" };

  const rawGuid = first(entry.objectGUID);
  const guid = Buffer.isBuffer(rawGuid) ? guidFromBuffer(rawGuid) : null;
  // The UPN (e.g. somchai@rpphosp.local) is the account email, as in portalrpp; `mail` is optional and not unique in AD.
  const email = text(entry.userPrincipalName).trim().toLowerCase();
  if (!guid || !email || email.length > 191) {
    console.error("LDAP entry is missing objectGUID or userPrincipalName");
    return { ok: false, code: "NOT_AUTHORIZED" };
  }

  const name = (text(entry.displayName) || text(entry.cn) || text(entry.sAMAccountName) || email).trim().slice(0, 191);
  return { ok: true, identity: { guid, email, name } };
}
