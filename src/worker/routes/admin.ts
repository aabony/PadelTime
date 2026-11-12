import { desc, eq, isNotNull, ne, and, sql } from "drizzle-orm";
import type { DB } from "../lib/detail";
import { Hono } from "hono";
import { parseGender } from "../../shared/genders";
import { normalizeLevel } from "../../shared/levels";
import { NO_STATS, deleteBlock, deleteBlockReason, guestNameFor } from "../../shared/members";
import type { MemberRow, MemberStats, MembersResponse } from "../../shared/members";
import { isProfileComplete } from "../../shared/profile";
import { gameSessions, groups, playerResults, sessionPlayers, user } from "../db/schema";
import { isAdminEmail } from "./admins";
import type { ApiCtx } from "./context";

export const adminRoutes = new Hono<ApiCtx>();

// Everyone who has registered, with their profile and what they've played.
// Admins only: this is the one place phone numbers, emails and dates of birth
// are listed together.
adminRoutes.get("/admin/members", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  if (!u.isAdmin) return c.json({ error: "Admins only" }, 403);
  const db = c.get("db");

  const users = await db.select().from(user).orderBy(desc(user.createdAt));

  // Games: one row per player per scored game, tied to an account through the roster entry.
  const games = await db
    .select({
      userId: sessionPlayers.userId,
      games: sql<number>`count(*)`,
      wins: sql<number>`sum(case when ${playerResults.result} = 'win' then 1 else 0 end)`,
      losses: sql<number>`sum(case when ${playerResults.result} = 'loss' then 1 else 0 end)`,
      ties: sql<number>`sum(case when ${playerResults.result} = 'tie' then 1 else 0 end)`,
      pointsFor: sql<number>`sum(${playerResults.pointsFor})`,
      pointsAgainst: sql<number>`sum(${playerResults.pointsAgainst})`,
      lastPlayedAt: sql<number>`max(${playerResults.createdAt})`,
    })
    .from(playerResults)
    .innerJoin(sessionPlayers, eq(playerResults.playerId, sessionPlayers.id))
    .where(isNotNull(sessionPlayers.userId))
    .groupBy(sessionPlayers.userId);

  const joined = await db
    .select({ userId: sessionPlayers.userId, tournaments: sql<number>`count(distinct ${sessionPlayers.sessionId})` })
    .from(sessionPlayers)
    .where(and(isNotNull(sessionPlayers.userId), ne(sessionPlayers.status, "dropped")))
    .groupBy(sessionPlayers.userId);

  const stats = new Map<string, MemberStats>();
  for (const j of joined) if (j.userId) stats.set(j.userId, { ...NO_STATS, tournaments: Number(j.tournaments) });
  for (const g of games) {
    if (!g.userId) continue;
    stats.set(g.userId, {
      tournaments: stats.get(g.userId)?.tournaments ?? 0,
      games: Number(g.games),
      wins: Number(g.wins),
      losses: Number(g.losses),
      ties: Number(g.ties),
      pointsFor: Number(g.pointsFor),
      pointsAgainst: Number(g.pointsAgainst),
      lastPlayedAt: g.lastPlayedAt == null ? null : Number(g.lastPlayedAt),
    });
  }

  const organized = await organizedCounts(db);

  const members: MemberRow[] = users.map((row) => {
    const profile = {
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      dob: row.dob,
      gender: parseGender(row.gender),
      level: normalizeLevel(row.level),
      playtomicLevel: row.playtomicLevel,
    };
    const isAdmin = row.isAdmin || isAdminEmail(c.env.ADMIN_EMAILS, row.email);
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      isAdmin,
      deleteBlockedBy: deleteBlock({ isSelf: row.id === u.id, isAdmin, organized: organized.get(row.id) ?? 0 }),
      profileComplete: isProfileComplete(profile),
      registeredAt: row.createdAt.getTime(),
      stats: stats.get(row.id) ?? { ...NO_STATS },
      ...profile,
    };
  });
  const res: MembersResponse = { members };
  return c.json(res);
});

/** Tournaments each account set up, or that live in a crew it owns — what a delete would leave without an owner. */
async function organizedCounts(db: DB, userId?: string): Promise<Map<string, number>> {
  const created = await db
    .select({ userId: gameSessions.createdBy, n: sql<number>`count(*)` })
    .from(gameSessions)
    .where(userId ? eq(gameSessions.createdBy, userId) : undefined)
    .groupBy(gameSessions.createdBy);
  const inOwnedCrews = await db
    .select({ userId: groups.ownerId, n: sql<number>`count(*)` })
    .from(groups)
    .innerJoin(gameSessions, eq(gameSessions.groupId, groups.id))
    .where(userId ? eq(groups.ownerId, userId) : undefined)
    .groupBy(groups.ownerId);
  const out = new Map<string, number>();
  for (const r of [...created, ...inOwnedCrews]) out.set(r.userId, Math.max(out.get(r.userId) ?? 0, Number(r.n)));
  return out;
}

// Delete a member's account: their profile, sign-in and crew memberships go.
// Their results don't — the roster entries they played under become guest
// entries in their name, so past tournaments read exactly as they did.
// Refused for your own account, another admin, and anyone who set up
// tournaments (those would be left without an owner).
adminRoutes.delete("/admin/members/:id", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  if (!u.isAdmin) return c.json({ error: "Admins only" }, 403);
  const db = c.get("db");
  const [target] = await db.select().from(user).where(eq(user.id, c.req.param("id"))).limit(1);
  if (!target) return c.json({ error: "That member no longer exists" }, 404);

  const name = guestNameFor(target.name, target.email);
  const organized = (await organizedCounts(db, target.id)).get(target.id) ?? 0;
  const block = deleteBlock({
    isSelf: target.id === u.id,
    isAdmin: target.isAdmin || isAdminEmail(c.env.ADMIN_EMAILS, target.email),
    organized,
  });
  if (block) return c.json({ error: deleteBlockReason(block, name, organized) }, 400);

  // All or nothing: a D1 batch is one transaction.
  await db.batch([
    // Results stay under their name, no longer tied to an account.
    db.update(sessionPlayers).set({ guestName: name, userId: null }).where(eq(sessionPlayers.userId, target.id)),
    // An empty crew they owned (no tournaments in it — checked above) goes with them.
    db.delete(groups).where(eq(groups.ownerId, target.id)),
    // The account itself; its sign-in sessions and crew memberships cascade.
    db.delete(user).where(eq(user.id, target.id)),
  ]);
  return c.json({ ok: true, name });
});
