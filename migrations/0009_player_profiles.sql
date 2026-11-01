-- Player profiles: collected once at registration, reused for every tournament.
-- `name` stays as "First Last" so everything that shows a name keeps working.
ALTER TABLE `user` ADD COLUMN `first_name` text;
ALTER TABLE `user` ADD COLUMN `last_name` text;
ALTER TABLE `user` ADD COLUMN `phone` text;
ALTER TABLE `user` ADD COLUMN `dob` text;
ALTER TABLE `user` ADD COLUMN `gender` text;
ALTER TABLE `user` ADD COLUMN `level` integer;
ALTER TABLE `user` ADD COLUMN `playtomic_level` real;
-- Admins run tournaments; everyone else just plays. Set from ADMIN_EMAILS on sign-in.
ALTER TABLE `user` ADD COLUMN `is_admin` integer NOT NULL DEFAULT 0;
