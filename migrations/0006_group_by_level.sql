-- Per-session "Group players by playing level" toggle (organizer-set levels live in session_players.level).
ALTER TABLE game_sessions ADD COLUMN group_by_level integer NOT NULL DEFAULT 0;
