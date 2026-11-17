import { desc, eq, inArray, isNotNull, isNull, ne, and, sql } from "drizzle-orm";
import type { DB } from "../lib/detail";
import { Hono } from "hono";
import { parseGender } from "../../shared/genders";
import { normalizeLevel } from "../../shared/levels";
import { NO_STATS, deleteBlock, deleteBlockReason, guestNameFor } from "../../shared/members";
import type { MemberRow, MemberStats, MembersResponse } from "../../shared/members";
import { isProfileComplete, validateProfilePatch } from "../../shared/profile";
import { gameSessions, groupMembers, groups, playerResults, sessionPlayers, user } from "../db/schema";
import type { GuestsResponse } from "../../shared/guests";
import { isTestPlayerName } from "../../shared/testPlayers";
import { newId, now } from "../lib/util";
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

// Edit a member's profile: the details the organizer knows (a phone, a level)
// without waiting for the player. Anything left empty stays empty and the
// player is still asked for it on their next sign-in. The email is the sign-in
// identity and isn't edited here.
adminRoutes.put("/admin/members/:id", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  if (!u.isAdmin) return c.json({ error: "Admins only" }, 403);
  const db = c.get("db");
  const [target] = await db.select().from(user).where(eq(user.id, c.req.param("id"))).limit(1);
  if (!target) return c.json({ error: "That member no longer exists" }, 404);

  const result = validateProfilePatch(await c.req.json().catch(() => ({})));
  if (!result.ok) return c.json({ error: result.error }, 400);
  const p = result.profile;
  // The name shown on court follows the first and last name; with neither given, the one already there stays.
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || target.name;
  await db
    .update(user)
    .set({ ...p, name, updatedAt: new Date() })
    .where(eq(user.id, target.id));
  return c.json({ ok: true, name, profileComplete: isProfileComplete(p) });
});

// Players without an account: everyone added to a roster by name who went on to
// play a scored game. Their results belong to no member until they're linked.
adminRoutes.get("/admin/guests", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  if (!u.isAdmin) return c.json({ error: "Admins only" }, 403);
  const db = c.get("db");
  const rows = await db
    .select({
      playerId: sessionPlayers.id,
      name: sessionPlayers.guestName,
      sessionId: gameSessions.id,
      sessionName: gameSessions.name,
      sessionAt: gameSessions.createdAt,
      games: sql<number>`count(${playerResults.id})`,
    })
    .from(sessionPlayers)
    .innerJoin(gameSessions, eq(sessionPlayers.sessionId, gameSessions.id))
    .innerJoin(playerResults, eq(playerResults.playerId, sessionPlayers.id))
    .where(isNull(sessionPlayers.userId))
    .groupBy(sessionPlayers.id);
  const res: GuestsResponse = {
    guests: rows
      .filter((r) => r.name && !isTestPlayerName(r.name))
      .map((r) => ({ playerId: r.playerId, name: r.name!, sessionId: r.sessionId, sessionName: r.sessionName, sessionAt: Number(r.sessionAt), games: Number(r.games) })),
  };
  return c.json(res);
});

// Link guest entries to a registered member: the entry becomes the member's own, so its games count
// in their stats and the tournament shows in their history. An entry in a tournament the member is
// already on is left alone (two rows for one person would deal them twice) and reported back.
adminRoutes.post("/admin/guests/link", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  if (!u.isAdmin) return c.json({ error: "Admins only" }, 403);
  const db = c.get("db");
  const body = await c.req.json().catch(() => ({}));
  const userId = typeof body.userId === "string" ? body.userId : "";
  const playerIds: string[] = Array.isArray(body.playerIds) ? body.playerIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 80) : [];
  if (!userId || playerIds.length === 0) return c.json({ error: "Pick a member and at least one tournament" }, 400);
  const [member] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!member) return c.json({ error: "That member no longer exists" }, 404);

  const entries = await db.select().from(sessionPlayers).where(inArray(sessionPlayers.id, playerIds));
  const guests = entries.filter((e) => !e.userId);
  const mine = await db.select({ sessionId: sessionPlayers.sessionId }).from(sessionPlayers).where(eq(sessionPlayers.userId, member.id));
  const already = new Set(mine.map((r) => r.sessionId));
  let linked = 0;
  const skipped: string[] = [];
  for (const g of guests) {
    if (already.has(g.sessionId)) {
      skipped.push(g.sessionId);
      continue;
    }
    await db.update(sessionPlayers).set({ userId: member.id, guestName: null }).where(eq(sessionPlayers.id, g.id));
    already.add(g.sessionId);
    linked++;
    // On a roster means part of that tournament's crew, as joining from the link does.
    const [session] = await db.select({ groupId: gameSessions.groupId }).from(gameSessions).where(eq(gameSessions.id, g.sessionId)).limit(1);
    if (session) {
      const [membership] = await db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, session.groupId), eq(groupMembers.userId, member.id)))
        .limit(1);
      if (!membership) await db.insert(groupMembers).values({ id: newId(), groupId: session.groupId, userId: member.id, role: "member", createdAt: now() });
    }
  }
  return c.json({ ok: true, linked, skipped: skipped.length, name: member.name || member.email });
});
