-- "Keep teams together": per-session switch, and each player's fixed partner (a session_players id; both rows point at each other).
ALTER TABLE game_sessions ADD COLUMN fixed_teams integer NOT NULL DEFAULT 0;
ALTER TABLE session_players ADD COLUMN partner_id text;
