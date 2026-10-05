import assert from "node:assert/strict";
import test from "node:test";

import { authenticateLdap, buildDirectorySearchFilter, buildUserFilter, guidFromBuffer, isAccountDisabled, isUnderOu, ldapConfig } from "./ldap.ts";

test("login names are escaped before going into the search filter", () => {
  const filter = buildUserFilter("(|(sAMAccountName={{username}})(mail={{username}}))", "*)(objectClass=*");
  assert.equal(filter, "(|(sAMAccountName=\\2a\\29\\28objectClass=\\2a)(mail=\\2a\\29\\28objectClass=\\2a))");
  // `$&` in the value must not be read as a replacement pattern.
  assert.equal(buildUserFilter("(uid={{username}})", "a$&b"), "(uid=a$&b)");
});

test("objectGUID bytes become the canonical AD GUID string", () => {
  const bytes = Buffer.from("40fc296b47ca6710b31d00dd010662da", "hex");
  assert.equal(guidFromBuffer(bytes), "6b29fc40-ca47-1067-b31d-00dd010662da");
  assert.equal(guidFromBuffer(Buffer.alloc(4)), null);
});

test("userAccountControl ACCOUNTDISABLE bit", () => {
  assert.equal(isAccountDisabled("512"), false);
  assert.equal(isAccountDisabled("514"), true);
  assert.equal(isAccountDisabled(""), false);
});

test("required OU matches a whole DN component only", () => {
  const dn = "CN=Somchai,OU=rpp-user,DC=rpphosp,DC=local";
  assert.equal(isUnderOu(dn, "rpp-user"), true);
  assert.equal(isUnderOu(dn, "RPP-USER"), true);
  assert.equal(isUnderOu("CN=x,OU=rpp-user-old,DC=rpphosp,DC=local", "rpp-user"), false);
  assert.equal(isUnderOu("CN=OU=rpp-user,OU=other,DC=local", "rpp-user"), false);
  assert.equal(isUnderOu(dn, ""), true);
});

test("config is off without LDAP_URL and strict once it is set", () => {
  assert.equal(ldapConfig({}), null);
  assert.throws(() => ldapConfig({ LDAP_URL: "ldaps://ad.example" }));
  const config = ldapConfig({ LDAP_URL: "ldaps://ad.example", LDAP_BASE_DN: "DC=x", LDAP_BIND_DN: "CN=svc,DC=x", LDAP_BIND_PASSWORD: "p" });
  assert.equal(config.tlsOptions.rejectUnauthorized, true);
  assert.equal(config.autoProvision, false);
});

test("an empty password is refused before any bind", async () => {
  const config = ldapConfig({ LDAP_URL: "ldap://127.0.0.1:1", LDAP_BASE_DN: "DC=x", LDAP_BIND_DN: "CN=svc,DC=x", LDAP_BIND_PASSWORD: "p" });
  assert.deepEqual(await authenticateLdap(config, "user", ""), { ok: false, code: "INVALID_CREDENTIALS" });
});

test("an unreachable directory reports UNAVAILABLE, not a wrong password", async () => {
  const config = ldapConfig({ LDAP_URL: "ldap://127.0.0.1:1", LDAP_BASE_DN: "DC=x", LDAP_BIND_DN: "CN=svc,DC=x", LDAP_BIND_PASSWORD: "p", LDAP_CONNECT_TIMEOUT: "1000" });
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await authenticateLdap(config, "user", "secret"), { ok: false, code: "UNAVAILABLE" });
  } finally {
    console.error = original;
  }
});

test("directory search text is escaped and only matches enabled people", () => {
  const filter = buildDirectorySearchFilter("สม*)(cn=*");
  assert.ok(filter.includes(String.raw`(displayName=*สม\2a\29\28cn=\2a*)`), filter);
  assert.ok(filter.startsWith("(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2))"));
  assert.equal((filter.match(/\(/g) ?? []).length, (filter.match(/\)/g) ?? []).length);
});
