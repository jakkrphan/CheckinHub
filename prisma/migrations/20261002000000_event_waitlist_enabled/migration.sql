-- Per-event switch for the waitlist. New events start with it off (full = registration refused).
-- Events that already exist keep the behaviour they were created with (waitlist on).
ALTER TABLE `Event` ADD COLUMN `waitlistEnabled` BOOLEAN NOT NULL DEFAULT false;
UPDATE `Event` SET `waitlistEnabled` = true;
