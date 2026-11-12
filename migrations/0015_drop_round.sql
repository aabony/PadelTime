-- The drop: with competitive sit-outs on, sit-outs rotate fairly up to this
-- round; from the next round the lowest points per game sit. Was "once
-- everyone has three games", which no countdown could promise.
ALTER TABLE `game_sessions` ADD COLUMN `competitive_after_round` integer NOT NULL DEFAULT 3;
