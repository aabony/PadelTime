import { desc, eq, isNotNull, ne, and, sql } from "drizzle-orm";
import { Hono } from "hono";
import { parseGender } from "../../shared/genders";
import { normalizeLevel } from "../../shared/levels";
import { NO_STATS } from "../../shared/members";
import type { MemberRow, MemberStats, MembersResponse } from "../../shared/members";
import { isProfileComplete } from "../../shared/profile";
import { playerResults, sessionPlayers, user } from "../db/schema";
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
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      isAdmin: row.isAdmin || isAdminEmail(c.env.ADMIN_EMAILS, row.email),
      profileComplete: isProfileComplete(profile),
      registeredAt: row.createdAt.getTime(),
      stats: stats.get(row.id) ?? { ...NO_STATS },
      ...profile,
    };
  });
  const res: MembersResponse = { members };
  return c.json(res);
});
