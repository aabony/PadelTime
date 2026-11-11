import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/worker/env";
import { COLUMNS } from "../src/worker/lib/ensureSchema";

// A stand-in for D1: tables with their column names, a log of what was run,
// and switches to make a call hang or fail the way production can.
function fakeDb(tables: Record<string, string[]>, opts: { hang?: boolean; noBatch?: boolean; raceOn?: string } = {}) {
  const log: string[] = [];
  const never = new Promise<never>(() => {});
  const stmt = (sql: string) => ({
    sql,
    bind: () => stmt(sql),
    async all() {
      log.push(sql);
      const table = sql.match(/table_info\((\w+)\)/)?.[1] ?? "";
      return { results: (tables[table] ?? []).map((name) => ({ name })) };
    },
    async run() {
      log.push(sql);
      const m = sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/);
      if (m) {
        // Another isolate added it first.
        if (opts.raceOn === m[2] || tables[m[1]].includes(m[2])) throw new Error(`duplicate column name: ${m[2]}`);
        tables[m[1]].push(m[2]);
      }
      return {};
    },
  });
  const db = {
    prepare: (sql: string) => stmt(sql),
    async batch(statements: ReturnType<typeof stmt>[]) {
      if (opts.hang) return never;
      if (opts.noBatch) throw new Error("batch not supported");
      log.push("BATCH");
      return Promise.all(statements.map((s) => s.all()));
    },
  };
  return { db: db as unknown as Env["DB"], log, tables };
}

async function load() {
  vi.resetModules(); // a fresh isolate: the "schema is up to date" flag starts false
  return import("../src/worker/lib/ensureSchema");
}

/** Every table with every column the app expects. */
const complete = () => {
  const tables: Record<string, string[]> = { session_players: ["id"], game_sessions: ["id"], user: ["id"], rounds: ["id"] };
  for (const c of COLUMNS) tables[c.table].push(c.column);
  return tables;
};

describe("ensureSchema", () => {
  beforeEach(() => vi.resetModules());

  it("up to date: one round trip, then nothing at all on later requests", async () => {
    const fresh = await load();
    const { db, log } = fakeDb(complete());
    await fresh.ensureSchema(db);
    expect(log.filter((l) => l === "BATCH")).toHaveLength(1);
    expect(log.some((l) => l.startsWith("ALTER"))).toBe(false);
    const before = log.length;
    await fresh.ensureSchema(db);
    await fresh.ensureSchema(db);
    expect(log.length).toBe(before);
  });

  it("adds what's missing and records the migration", async () => {
    const tables = complete();
    tables.game_sessions = tables.game_sessions.filter((c) => c !== "beginner_court_no");
    tables.user = tables.user.filter((c) => c !== "phone" && c !== "dob");
    const { ensureSchema } = await load();
    const { db, log } = fakeDb(tables);
    await ensureSchema(db);
    expect(log).toContain("ALTER TABLE game_sessions ADD COLUMN beginner_court_no integer NOT NULL DEFAULT 1");
    expect(log).toContain("ALTER TABLE user ADD COLUMN phone text");
    expect(log).toContain("ALTER TABLE user ADD COLUMN dob text");
    expect(log.filter((l) => l.startsWith("ALTER"))).toHaveLength(3);
    expect(log.filter((l) => l.startsWith("INSERT OR IGNORE INTO d1_migrations"))).toHaveLength(2);
  });

  it("a cancelled first request doesn't leave the next one hanging", async () => {
    // The regression: request A is cancelled mid-check (its promise never
    // settles); request B used to await A's promise and spin forever.
    const fresh = await load();
    const hung = fakeDb(complete(), { hang: true });
    const a = fresh.ensureSchema(hung.db);
    let aSettled = false;
    void a.then(() => (aSettled = true)).catch(() => (aSettled = true));

    const ok = fakeDb(complete());
    const b = fresh.ensureSchema(ok.db);
    const winner = await Promise.race([b.then(() => "b done"), new Promise((r) => setTimeout(() => r("b hung"), 500))]);
    expect(winner).toBe("b done");
    expect(aSettled).toBe(false);
  });

  it("two requests racing to add the same column both succeed", async () => {
    const tables = complete();
    tables.game_sessions = tables.game_sessions.filter((c) => c !== "beginner_court_no");
    const { ensureSchema } = await load();
    const { db } = fakeDb(tables, { raceOn: "beginner_court_no" });
    await expect(ensureSchema(db)).resolves.toBeUndefined();
  });

  it("falls back to one query per table when batching isn't available", async () => {
    const tables = complete();
    const { ensureSchema } = await load();
    const { db, log } = fakeDb(tables, { noBatch: true });
    await ensureSchema(db);
    expect(log.filter((l) => l.startsWith("PRAGMA"))).toHaveLength(4);
  });

  it("a real failure is thrown and retried by the next request", async () => {
    const tables = complete();
    tables.user = tables.user.filter((c) => c !== "is_admin");
    const { ensureSchema } = await load();
    const broken = fakeDb(tables);
    const realPrepare = broken.db.prepare.bind(broken.db);
    let fail = true;
    (broken.db as unknown as { prepare: (s: string) => unknown }).prepare = (sql: string) => {
      const s = realPrepare(sql) as unknown as { run: () => Promise<unknown> };
      if (fail && sql.startsWith("ALTER")) s.run = async () => Promise.reject(new Error("D1 is unavailable"));
      return s;
    };
    await expect(ensureSchema(broken.db)).rejects.toThrow("D1 is unavailable");
    fail = false;
    await expect(ensureSchema(broken.db)).resolves.toBeUndefined();
    expect(tables.user).toContain("is_admin");
  });
});
