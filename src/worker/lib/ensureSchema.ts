import type { Env } from "../env";

// Production D1 can't be migrated from this environment (the deploy token has
// no D1 permission), so additive migrations are also applied lazily here, on
// the first API requests of each isolate. Idempotent and cheap: one round trip
// reads the columns of the tables; nothing else happens once they're all
// there. Records the migration so wrangler's bookkeeping stays in sync.
//
// IMPORTANT: no promise is shared between requests. On Workers a request is
// cancelled when its client disconnects (a reload, a closed tab), and a promise
// created in that request then never settles — anything else awaiting it hangs
// until its own client gives up. Sharing the in-flight check did exactly that:
// one cancelled first request left every later request on the isolate spinning.
// So each request runs its own check until one of them has seen the schema
// complete; only that boolean is shared.
let upToDate = false;

const TABLES = ["session_players", "game_sessions", "user", "rounds"] as const;

interface Column {
  migration: string;
  table: (typeof TABLES)[number];
  column: string;
  type: string;
}

const NN0 = "integer NOT NULL DEFAULT 0";

/** Every column added since 0001, in migration order. Add new ones at the end. */
export const COLUMNS: Column[] = [
  { migration: "0004_player_levels.sql", table: "session_players", column: "level", type: "integer" },
  { migration: "0005_gender_mixed_pairs.sql", table: "session_players", column: "gender", type: "text" },
  { migration: "0005_gender_mixed_pairs.sql", table: "game_sessions", column: "mixed_pairs", type: NN0 },
  { migration: "0006_group_by_level.sql", table: "game_sessions", column: "group_by_level", type: NN0 },
  { migration: "0007_fixed_teams.sql", table: "game_sessions", column: "fixed_teams", type: NN0 },
  { migration: "0007_fixed_teams.sql", table: "session_players", column: "partner_id", type: "text" },
  { migration: "0008_court_labels.sql", table: "game_sessions", column: "court_labels", type: "text" },
  { migration: "0009_beginner_court.sql", table: "game_sessions", column: "beginner_court", type: NN0 },
  { migration: "0009_beginner_court.sql", table: "game_sessions", column: "competitive_sitouts", type: NN0 },
  { migration: "0009_beginner_court.sql", table: "session_players", column: "newbie", type: NN0 },
  { migration: "0010_player_profiles.sql", table: "user", column: "first_name", type: "text" },
  { migration: "0010_player_profiles.sql", table: "user", column: "last_name", type: "text" },
  { migration: "0010_player_profiles.sql", table: "user", column: "phone", type: "text" },
  { migration: "0010_player_profiles.sql", table: "user", column: "dob", type: "text" },
  { migration: "0010_player_profiles.sql", table: "user", column: "gender", type: "text" },
  { migration: "0010_player_profiles.sql", table: "user", column: "level", type: "integer" },
  { migration: "0010_player_profiles.sql", table: "user", column: "playtomic_level", type: "real" },
  { migration: "0010_player_profiles.sql", table: "user", column: "is_admin", type: NN0 },
  { migration: "0011_beginner_court_no.sql", table: "game_sessions", column: "beginner_court_no", type: "integer NOT NULL DEFAULT 1" },
  { migration: "0012_coached_court.sql", table: "game_sessions", column: "beginner_court_coached", type: NN0 },
  { migration: "0013_beginner_track.sql", table: "rounds", column: "track", type: "text" },
  { migration: "0014_finals.sql", table: "game_sessions", column: "finals", type: NN0 },
];

export async function ensureSchema(db: Env["DB"]): Promise<void> {
  if (upToDate) return;
  await apply(db);
  upToDate = true;
}

/** The columns each table has now — one round trip, falling back to one per table. */
async function existingColumns(db: Env["DB"]): Promise<Map<string, Set<string>>> {
  const statements = TABLES.map((t) => db.prepare(`PRAGMA table_info(${t})`));
  let rows: { name: string }[][];
  try {
    rows = (await db.batch<{ name: string }>(statements)).map((r) => r.results);
  } catch {
    rows = [];
    for (const s of statements) rows.push((await s.all<{ name: string }>()).results);
  }
  return new Map(TABLES.map((t, i) => [t, new Set(rows[i].map((c) => c.name))]));
}

async function apply(db: Env["DB"]): Promise<void> {
  const have = await existingColumns(db);
  // A table with no columns doesn't exist yet (a database before 0001): leave it to the real migrations.
  const missing = COLUMNS.filter((c) => {
    const columns = have.get(c.table);
    return columns && columns.size > 0 && !columns.has(c.column);
  });
  if (missing.length === 0) return;

  const applied = new Set<string>();
  for (const c of missing) {
    try {
      await db.prepare(`ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${c.type}`).run();
    } catch (e) {
      // Another request (or isolate) added it between our read and our write.
      if (!/duplicate column/i.test(String((e as Error)?.message ?? e))) throw e;
    }
    applied.add(c.migration);
  }
  for (const name of applied) {
    try {
      await db.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)").bind(name).run();
    } catch {
      // bookkeeping only
    }
  }
}
