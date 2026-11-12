-- Finals: the organizer's switch for the end of the night. While it's on, each
-- round goes to the top of the table and everyone else sits.
ALTER TABLE `game_sessions` ADD COLUMN `finals` integer NOT NULL DEFAULT 0;
