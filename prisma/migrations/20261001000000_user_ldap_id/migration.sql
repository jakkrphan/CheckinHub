-- LDAP/AD sign-in: links a User to its directory entry by objectGUID (docs/ARCHITECTURE.md "Authentication roadmap").
ALTER TABLE `User` ADD COLUMN `ldapId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `User_ldapId_key` ON `User`(`ldapId`);
