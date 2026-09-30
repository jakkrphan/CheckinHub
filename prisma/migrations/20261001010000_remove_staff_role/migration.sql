-- STAFF system role removed: check-in-only access is per event (EventOrganizer.role = CHECKIN_ONLY).
-- Existing STAFF accounts become ORGANIZER; their event memberships are unchanged.
UPDATE `User` SET `role` = 'ORGANIZER' WHERE `role` = 'STAFF';
ALTER TABLE `User` MODIFY `role` ENUM('ORGANIZER', 'ADMIN') NOT NULL DEFAULT 'ORGANIZER';
