-- The beginner court can be a coached court instead of a games court: players
-- tagged Newbie train there with a coach and are left out of the draw.
ALTER TABLE `game_sessions` ADD COLUMN `beginner_court_coached` integer NOT NULL DEFAULT 0;
