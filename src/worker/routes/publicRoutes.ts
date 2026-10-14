import { and, desc, eq, isNotNull, like } from "drizzle-orm";
import { Hono } from "hono";
import type { BoardData, JoinInfo, PlayerStatus, SessionStatus } from "../../shared/types";
import { computeStandings } from "../../shared/standings";
import { groupMembers, sessionPlayers, verification } from "../db/schema";
import type { DB } from "../lib/detail";
import { loadPlayers, loadRounds, loadSessionByCode } from "../lib/detail";
import { parseGender } from "../../shared/genders";
import type { Gender } from "../../shared/genders";
import { newId, now } from "../lib/util";
import type { ApiCtx } from "./context";

export const publicRoutes = new Hono<ApiCtx>();

// Local-development only: lets tests read the latest sign-in code instead of
// an inbox. Gated on DEV_MODE=1, which only .dev.vars ever sets — the check
// happens per request, and production has no DEV_MODE var.
publicRoutes.get("/dev/otp", async (c) => {
  if (c.env.DEV_MODE !== "1") return c.json({ error: "Not found" }, 404);
  const email = (c.req.query("email") ?? "").toLowerCase();
  if (!email) return c.json({ error: "email required" }, 400);
  const db = c.get("db");
  const [row] = await db
    .select()
    .from(verification)
    .where(like(verification.identifier, `%otp%${email}%`))
    .orderBy(desc(verification.createdAt))
    .limit(1);
  if (!row) return c.json({ error: "No code found" }, 404);
  return c.json({ identifier: row.identifier, value: row.value });
});

/** The gender a player last gave, so they don't answer every session. */
async function rememberedGender(db: DB, userId: string): Promise<Gender | null> {
  const [row] = await db
    .select({ gender: sessionPlayers.gender })
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.userId, userId), isNotNull(sessionPlayers.gender)))
    .orderBy(desc(sessionPlayers.joinedAt))
    .limit(1);
  return parseGender(row?.gender);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const firstName = (s: string) => norm(s).split(" ")[0] ?? "";

/**
 * Organizers often pre-add people by first name ("Daniel"), then the same
 * person joins with an account ("Daniel Bogatin"). If exactly one unclaimed
 * guest matches the account's name, the guest entry becomes theirs instead of
 * a duplicate. Ambiguous cases ("Brandon P" and "Brandon P2") are left for the
 * organizer's merge button.
 */
function claimableGuest<T extends { userId: string | null; guestName: string | null; status: string }>(
  players: T[],
  userName: string | null | undefined,
): T | null {
  if (!userName) return null;
  const guests = players.filter((p) => !p.userId && p.guestName && p.status !== "dropped");
  const exact = guests.filter((p) => norm(p.guestName!) === norm(userName));
  if (exact.length === 1) return exact[0];
  const byFirst = guests.filter((p) => firstName(p.guestName!) === firstName(userName));
  return byFirst.length === 1 ? byFirst[0] : null;
}

// Public info for an invite link — enough to decide to join.
publicRoutes.get("/join/:code", async (c) => {
  const db = c.get("db");
  const loaded = await loadSessionByCode(db, c.req.param("code"));
  if (!loaded) return c.json({ error: "That invite link doesn't exist" }, 404);
  const { session, groupName } = loaded;
  const players = await db
    .select()
    .from(sessionPlayers)
    .where(eq(sessionPlayers.sessionId, session.id));

  const u = c.get("user");
  const mine = u ? players.find((p) => p.userId === u.id) : undefined;
  const info: JoinInfo = {
    sessionId: session.id,
    name: session.name,
    groupName,
    venue: session.venue,
    startsAt: session.startsAt,
    durationMin: session.durationMin,
    status: session.status as SessionStatus,
    format: session.format as JoinInfo["format"],
    courts: session.courts,
    maxPlayers: session.maxPlayers,
    pointsPerMatch: session.pointsPerMatch,
    confirmedCount: players.filter((p) => p.status === "confirmed" || p.status === "checked_in").length,
    waitlistCount: players.filter((p) => p.status === "waitlist").length,
    roundsPlayed: (await loadRounds(db, session.id)).length,
    myStatus: (mine?.status as PlayerStatus) ?? null,
    myGender: parseGender(mine?.gender) ?? (u ? await rememberedGender(db, u.id) : null),
    mixedPairs: session.mixedPairs,
    groupByLevel: session.groupByLevel,
  };
  return c.json(info);
});

// Join via invite link → confirmed, or waitlist when full (plan §8). The link
// keeps working once the game is on: late arrivals join themselves and are
// dealt in from the next round. `here: true` checks them in on the spot.
publicRoutes.post("/join/:code", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSessionByCode(db, c.req.param("code"));
  if (!loaded) return c.json({ error: "That invite link doesn't exist" }, 404);
  const { session } = loaded;
  if (!["open", "checkin", "active"].includes(session.status)) {
    const msg = session.status === "draft" ? "Signup hasn't opened yet — check back soon" : "This session is over";
    return c.json({ error: msg }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const playing = ["checkin", "active"].includes(session.status);
  const here = playing && body.here === true;

  const players = await db
    .select()
    .from(sessionPlayers)
    .where(eq(sessionPlayers.sessionId, session.id));
  const taken = players.filter((p) => p.status === "confirmed" || p.status === "checked_in").length;
  const target: PlayerStatus = taken >= session.maxPlayers ? "waitlist" : here ? "checked_in" : "confirmed";
  const checkedInAt = target === "checked_in" ? now() : null;
  const requestedGender = parseGender(body.gender);

  const existing = players.find((p) => p.userId === u.id);
  if (existing) {
    const changes: Partial<typeof sessionPlayers.$inferInsert> = {};
    if (existing.status === "dropped") {
      Object.assign(changes, { status: target, joinedAt: now(), checkedInAt });
    } else if (existing.status === "confirmed" && here) {
      Object.assign(changes, { status: "checked_in", checkedInAt: now() });
    }
    if (requestedGender != null) changes.gender = requestedGender;
    if (Object.keys(changes).length > 0) {
      await db.update(sessionPlayers).set(changes).where(eq(sessionPlayers.id, existing.id));
    }
    return c.json({ status: changes.status ?? existing.status });
  }

  const gender = requestedGender ?? (await rememberedGender(db, u.id));
  const guest = claimableGuest(players, u.name);
  if (guest) {
    // The organizer already added this person by name — take that entry over.
    const status = here && guest.status === "confirmed" ? "checked_in" : guest.status;
    await db
      .update(sessionPlayers)
      .set({
        userId: u.id,
        guestName: null,
        status,
        checkedInAt: status === "checked_in" ? (guest.checkedInAt ?? now()) : guest.checkedInAt,
        gender: parseGender(guest.gender) ?? gender,
      })
      .where(eq(sessionPlayers.id, guest.id));
    return c.json({ status });
  }

  await db.insert(sessionPlayers).values({
    id: newId(),
    sessionId: session.id,
    userId: u.id,
    guestName: null,
    status: target,
    joinedAt: now(),
    checkedInAt,
    gender,
  });

  // Joining a session makes you part of its group (recurring-group model, plan §18).
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, session.groupId), eq(groupMembers.userId, u.id)))
    .limit(1);
  if (!membership) {
    await db.insert(groupMembers).values({
      id: newId(),
      groupId: session.groupId,
      userId: u.id,
      role: "member",
      createdAt: now(),
    });
  }
  return c.json({ status: target });
});

// Read-only live board for the invite code — the TV / court display (plan §16).
publicRoutes.get("/board/:code", async (c) => {
  const db = c.get("db");
  const loaded = await loadSessionByCode(db, c.req.param("code"));
  if (!loaded) return c.json({ error: "Board not found" }, 404);
  const { session, groupName } = loaded;
  const players = await loadPlayers(db, session.id);
  const rounds = await loadRounds(db, session.id);
  const board: BoardData = {
    name: session.name,
    groupName,
    status: session.status as SessionStatus,
    format: session.format as BoardData["format"],
    pointsPerMatch: session.pointsPerMatch,
    players: players.map((p) => ({ id: p.id, name: p.name })),
    rounds,
    // People who never made it onto a court don't belong on the TV.
    standings: computeStandings(players, rounds).filter((s) => {
      const p = players.find((x) => x.id === s.playerId);
      return s.played > 0 || p?.status === "checked_in";
    }),
  };
  return c.json(board);
});
