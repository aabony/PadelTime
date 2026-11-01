-- Beginner court: court 1 reserved for organizer-tagged newbies (own rotation and table); competitive sit-outs bench the bottom of each pool after a floor of games.
ALTER TABLE game_sessions ADD COLUMN beginner_court integer NOT NULL DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN competitive_sitouts integer NOT NULL DEFAULT 0;
ALTER TABLE session_players ADD COLUMN newbie integer NOT NULL DEFAULT 0;
