-- The newbie cap: the most newbies a night takes (null = no limit). A Newbie
-- who signs up after the spots are gone goes on the waitlist.
ALTER TABLE `game_sessions` ADD COLUMN `max_newbies` integer;
