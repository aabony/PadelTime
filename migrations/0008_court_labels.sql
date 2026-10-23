-- The courts actually rented ("3,4"): shown instead of Court 1 / Court 2. Null = numbered 1..n.
ALTER TABLE game_sessions ADD COLUMN court_labels text;
