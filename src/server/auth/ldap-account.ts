import { db } from "@/server/db";

import type { LdapIdentity } from "./ldap";

const isUniqueViolation = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "P2002";

/**
 * Maps a verified directory identity to our User. Order: an account already linked by objectGUID; else an
 * unlinked account an admin created with the same email (linked now, pending invite links revoked); else, only
 * when LDAP_AUTO_PROVISION is on, a new ORGANIZER account.
 * Returns null when there is no account to sign in to. isActive is checked by the caller.
 */
export async function resolveLdapUser(identity: LdapIdentity, autoProvision: boolean) {
  const select = { id: true, name: true, email: true, isActive: true } as const;

  const linked = await db.user.findUnique({ where: { ldapId: identity.guid }, select });
  if (linked) return linked;

  const byEmail = await db.user.findUnique({ where: { email: identity.email }, select: { ...select, ldapId: true } });
  if (byEmail) {
    // Already bound to another directory entry (e.g. the AD account was recreated): an admin must resolve it.
    if (byEmail.ldapId) return null;
    const claimed = await db.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({ where: { id: byEmail.id, ldapId: null }, data: { ldapId: identity.guid } });
      if (!updated.count) return false;
      await tx.userToken.deleteMany({ where: { userId: byEmail.id, kind: "INVITE", usedAt: null } });
      await tx.auditLog.create({ data: { actorId: byEmail.id, action: "ACCOUNT_LDAP_LINKED", target: byEmail.id } });
      return true;
    }).catch((error) => { if (isUniqueViolation(error)) return false; throw error; });
    if (!claimed) return db.user.findUnique({ where: { ldapId: identity.guid }, select });
    return { id: byEmail.id, name: byEmail.name, email: byEmail.email, isActive: byEmail.isActive };
  }

  if (!autoProvision) return null;
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: identity.name, email: identity.email, ldapId: identity.guid, role: "ORGANIZER" }, select });
      await tx.auditLog.create({ data: { actorId: user.id, action: "ACCOUNT_LDAP_PROVISIONED", target: user.id, metadata: { role: "ORGANIZER" } } });
      return user;
    });
  } catch (error) {
    // A concurrent first sign-in created it first.
    if (isUniqueViolation(error)) return db.user.findUnique({ where: { ldapId: identity.guid }, select });
    throw error;
  }
}
