-- Rounds say which sequence they belong to: 'main' (the tournament's rounds) or
-- 'beginner' (the beginner court's own games, dealt one at a time on their own
-- clock). NULL = dealt before the tracks existed, when one round held both.
ALTER TABLE `rounds` ADD COLUMN `track` text;
