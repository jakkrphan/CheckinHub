-- Station (check-in point) that recorded each check-in, set per device.
ALTER TABLE `CheckIn` ADD COLUMN `station` VARCHAR(64) NULL;
