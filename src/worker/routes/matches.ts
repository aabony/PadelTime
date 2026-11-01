import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { matches, scoreAudit, sessionPlayers } from "../db/schema";
import type { DB, SessionRow } from "../lib/detail";
import { isGroupOrganizer, loadSession } from "../lib/detail";
import { clearMatchResults, keepUpNext, writeMatchResults } from "../lib/engine";
import { asInt, newId, now } from "../lib/util";
import type { ApiCtx, AuthedUser } from "./context";

export const matchRoutes = new Hono<ApiCtx>();

type MatchDbRow = typeof matches.$inferSelect;

interface MatchContext {
  match: MatchDbRow;
  session: SessionRow;
  isOrganizer: boolean;
  myPlayerId: string | null;
  myTeam: "a" | "b" | null;
}

async function loadMatchContext(
  db: DB,
  matchId: string,
  u: AuthedUser,
): Promise<MatchContext | null> {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) return null;
  const loaded = await loadSession(db, match.sessionId);
  if (!loaded) return null;
  const { session } = loaded;
  const isOrganizer =
    session.createdBy === u.id || (await isGroupOrganizer(db, session.groupId, u.id));
  const [me] = await db
    .select()
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.userId, u.id)))
    .limit(1);
  const myPlayerId = me?.id ?? null;
  const myTeam = !myPlayerId
    ? null
    : [match.a1, match.a2].includes(myPlayerId)
      ? "a"
      : [match.b1, match.b2].includes(myPlayerId)
        ? "b"
        : null;
  return { match, session, isOrganizer, myPlayerId, myTeam };
}

async function audit(
  db: DB,
  ctx: MatchContext,
  actorUserId: string,
  action: string,
  scoreA: number | null,
  scoreB: number | null,
): Promise<void> {
  await db.insert(scoreAudit).values({
    id: newId(),
    sessionId: ctx.session.id,
    matchId: ctx.match.id,
    actorUserId,
    action,
    scoreA,
    scoreB,
    createdAt: now(),
  });
}

// Submit a score. Players submit for their own match (opponents confirm);
// organizers enter or correct scores with immediate authority (plan §14).
matchRoutes.post("/matches/:id/score", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const ctx = await loadMatchContext(db, c.req.param("id"), u);
  if (!ctx) return c.json({ error: "Match not found" }, 404);
  if (ctx.session.status !== "active") return c.json({ error: "Session isn't live" }, 400);

  const body = await c.req.json().catch(() => ({}));
  const scoreA = asInt(body.scoreA);
  const scoreB = asInt(body.scoreB);
  if (scoreA == null || scoreB == null || scoreA < 0 || scoreB < 0) {
    return c.json({ error: "Scores must be whole numbers" }, 400);
  }
  if (scoreA + scoreB !== ctx.session.pointsPerMatch) {
    return c.json({ error: `Scores must add up to ${ctx.session.pointsPerMatch}` }, 400);
  }

  const ts = now();
  if (ctx.isOrganizer) {
    const wasScored = ctx.match.scoreA != null;
    await db
      .update(matches)
      .set({
        scoreA,
        scoreB,
        status: "confirmed",
        submittedBy: ctx.myPlayerId,
        submittedAt: ts,
        confirmedBy: ctx.myPlayerId,
        confirmedAt: ts,
      })
      .where(eq(matches.id, ctx.match.id));
    await writeMatchResults(db, { ...ctx.match, scoreA, scoreB });
    await audit(db, ctx, u.id, wasScored ? "edit" : "submit", scoreA, scoreB);
    await keepUpNext(db, ctx.session);
    return c.json({ ok: true, status: "confirmed" });
  }

  if (!ctx.myTeam) return c.json({ error: "You're not playing in this match" }, 403);

  // Auto-confirm when the opposing team has no account-holding player to confirm.
  const opposing =
    ctx.myTeam === "a" ? [ctx.match.b1, ctx.match.b2] : [ctx.match.a1, ctx.match.a2];
  const opposingUsers = await db
    .select()
    .from(sessionPlayers)
    .where(and(inArray(sessionPlayers.id, opposing), isNotNull(sessionPlayers.userId)));
  const autoConfirm = opposingUsers.length === 0;

  await clearMatchResults(db, ctx.match.id);
  await db
    .update(matches)
    .set({
      scoreA,
      scoreB,
      status: autoConfirm ? "confirmed" : "submitted",
      submittedBy: ctx.myPlayerId,
      submittedAt: ts,
      confirmedBy: autoConfirm ? ctx.myPlayerId : null,
      confirmedAt: autoConfirm ? ts : null,
    })
    .where(eq(matches.id, ctx.match.id));
  if (autoConfirm) {
    await writeMatchResults(db, { ...ctx.match, scoreA, scoreB });
    await keepUpNext(db, ctx.session);
  }
  await audit(db, ctx, u.id, "submit", scoreA, scoreB);
  return c.json({ ok: true, status: autoConfirm ? "confirmed" : "submitted" });
});

// A player from the opposing team (or an organizer) makes the score official.
matchRoutes.post("/matches/:id/confirm", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const ctx = await loadMatchContext(db, c.req.param("id"), u);
  if (!ctx) return c.json({ error: "Match not found" }, 404);
  if (!["submitted", "disputed"].includes(ctx.match.status)) {
    return c.json({ error: "There's no pending score to confirm" }, 400);
  }

  if (!ctx.isOrganizer) {
    if (!ctx.myTeam) return c.json({ error: "You're not playing in this match" }, 403);
    const submitterTeam = [ctx.match.a1, ctx.match.a2].includes(ctx.match.submittedBy ?? "")
      ? "a"
      : "b";
    if (ctx.myTeam === submitterTeam) {
      return c.json({ error: "Someone from the other team has to confirm" }, 400);
    }
  }

  const ts = now();
  await db
    .update(matches)
    .set({ status: "confirmed", confirmedBy: ctx.myPlayerId, confirmedAt: ts })
    .where(eq(matches.id, ctx.match.id));
  await writeMatchResults(db, ctx.match);
  await keepUpNext(db, ctx.session);
  await audit(db, ctx, u.id, "confirm", ctx.match.scoreA, ctx.match.scoreB);
  return c.json({ ok: true });
});

// Flag a submitted score for the organizer to settle.
matchRoutes.post("/matches/:id/dispute", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const ctx = await loadMatchContext(db, c.req.param("id"), u);
  if (!ctx) return c.json({ error: "Match not found" }, 404);
  if (ctx.match.status !== "submitted") {
    return c.json({ error: "Only a pending score can be disputed" }, 400);
  }
  if (!ctx.myTeam && !ctx.isOrganizer) {
    return c.json({ error: "You're not playing in this match" }, 403);
  }
  await db.update(matches).set({ status: "disputed" }).where(eq(matches.id, ctx.match.id));
  await audit(db, ctx, u.id, "dispute", ctx.match.scoreA, ctx.match.scoreB);
  return c.json({ ok: true });
});
