-- Which court is the beginner court (1-based, internal numbering). It used to be court 1 always.
ALTER TABLE `game_sessions` ADD COLUMN `beginner_court_no` integer NOT NULL DEFAULT 1;
