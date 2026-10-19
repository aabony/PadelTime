import type { Env } from "../env";

// Production D1 can't be migrated from this environment (the deploy token has
// no D1 permission), so additive migrations are also applied lazily here:
// once per isolate, on the first API request. Idempotent and cheap (one
// PRAGMA); records the migration so wrangler's bookkeeping stays in sync.
let ready: Promise<void> | null = null;

export function ensureSchema(db: Env["DB"]): Promise<void> {
  if (!ready) {
    ready = apply(db).catch((e) => {
      ready = null; // retry on the next request
      throw e;
    });
  }
  return ready;
}

async function apply(db: Env["DB"]): Promise<void> {
  const columns = async (table: string) =>
    new Set((await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((c) => c.name));
  const record = async (name: string) => {
    try {
      await db.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)").bind(name).run();
    } catch {
      // bookkeeping only
    }
  };
  const players = await columns("session_players");
  if (!players.has("level")) {
    await db.prepare("ALTER TABLE session_players ADD COLUMN level integer").run();
    await record("0004_player_levels.sql");
  }
  if (!players.has("gender")) {
    await db.prepare("ALTER TABLE session_players ADD COLUMN gender text").run();
    const sessions = await columns("game_sessions");
    if (!sessions.has("mixed_pairs")) {
      await db.prepare("ALTER TABLE game_sessions ADD COLUMN mixed_pairs integer NOT NULL DEFAULT 0").run();
    }
    await record("0005_gender_mixed_pairs.sql");
  }
  const sessions = await columns("game_sessions");
  if (!sessions.has("group_by_level")) {
    await db.prepare("ALTER TABLE game_sessions ADD COLUMN group_by_level integer NOT NULL DEFAULT 0").run();
    await record("0006_group_by_level.sql");
  }
  // Each column checked on its own, so a half-applied run finishes next time.
  const hasTeams = sessions.has("fixed_teams");
  const hasPartner = (await columns("session_players")).has("partner_id");
  if (!hasTeams) await db.prepare("ALTER TABLE game_sessions ADD COLUMN fixed_teams integer NOT NULL DEFAULT 0").run();
  if (!hasPartner) await db.prepare("ALTER TABLE session_players ADD COLUMN partner_id text").run();
  if (!hasTeams || !hasPartner) await record("0007_fixed_teams.sql");
}
