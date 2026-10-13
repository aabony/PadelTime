import { and, eq, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { gameSessions, matches, rounds, sessionPlayers } from "../db/schema";
import type { DB, SessionRow } from "../lib/detail";
import { buildDetail, isGroupMember, isGroupOrganizer, loadRounds, loadSession } from "../lib/detail";
import { generateNextRound } from "../lib/engine";
import { getFormat } from "../../shared/formats/registry";
import { parseGender } from "../../shared/genders";
import { parseLevel } from "../../shared/levels";
import { asInt, newId, now, trimmed } from "../lib/util";
import type { ApiCtx, AuthedUser } from "./context";

export const sessionRoutes = new Hono<ApiCtx>();

async function canManage(db: DB, session: SessionRow, u: AuthedUser | null): Promise<boolean> {
  if (!u) return false;
  return session.createdBy === u.id || (await isGroupOrganizer(db, session.groupId, u.id));
}

/** Fill freed confirmed spots from the waitlist, oldest joiners first. */
async function promoteWaitlist(db: DB, session: SessionRow): Promise<void> {
  const players = await db
    .select()
    .from(sessionPlayers)
    .where(eq(sessionPlayers.sessionId, session.id));
  const taken = players.filter((p) => p.status === "confirmed" || p.status === "checked_in").length;
  const waiting = players
    .filter((p) => p.status === "waitlist")
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const spots = Math.max(0, session.maxPlayers - taken);
  for (const p of waiting.slice(0, spots)) {
    await db.update(sessionPlayers).set({ status: "confirmed" }).where(eq(sessionPlayers.id, p.id));
  }
}

sessionRoutes.get("/sessions/:id", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session, groupName, groupIsPersonal } = loaded;

  const [asPlayer] = await db
    .select()
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.userId, u.id)))
    .limit(1);
  const allowed =
    !!asPlayer || (await isGroupMember(db, session.groupId, u.id)) || (await canManage(db, session, u));
  if (!allowed) return c.json({ error: "You don't have access to this session" }, 403);

  return c.json(await buildDetail(db, session, groupName, u.id, groupIsPersonal));
});

sessionRoutes.patch("/sessions/:id", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (!(await canManage(db, session, u))) return c.json({ error: "Organizers only" }, 403);

  const body = await c.req.json().catch(() => ({}));
  const patch: Partial<typeof gameSessions.$inferInsert> = {};
  const name = trimmed(body.name, 80);
  if (name) patch.name = name;
  if ("venue" in body) patch.venue = trimmed(body.venue, 80);
  if ("startsAt" in body) patch.startsAt = asInt(body.startsAt);
  if ("durationMin" in body) {
    const dur = asInt(body.durationMin);
    patch.durationMin = dur == null || dur <= 0 ? null : Math.min(dur, 600);
  }
  const courts = asInt(body.courts);
  if (courts != null) patch.courts = Math.min(Math.max(courts, 1), 12);
  // Casual ↔ competitive can flip any time before the session is over; the
  // next round dealt uses the new strategy.
  if (typeof body.format === "string" && !["complete", "cancelled"].includes(session.status)) {
    const format = getFormat(body.format);
    if (!format) return c.json({ error: `Unknown format "${body.format}"` }, 400);
    patch.format = format.key;
  }
  if (typeof body.mixedPairs === "boolean") patch.mixedPairs = body.mixedPairs;
  if (typeof body.groupByLevel === "boolean") patch.groupByLevel = body.groupByLevel;

  // Max players can change any time (extra people turn up mid-session); the
  // points per match are locked once a round has been dealt, since every
  // score on the board is relative to that total.
  const maxPlayers = asInt(body.maxPlayers);
  if (maxPlayers != null) patch.maxPlayers = Math.min(Math.max(maxPlayers, 4), 64);
  const points = asInt(body.pointsPerMatch);
  if (points != null && points !== session.pointsPerMatch) {
    if ((await loadRounds(db, session.id)).length > 0) {
      return c.json({ error: "Points per match can't change once a round has been dealt" }, 400);
    }
    patch.pointsPerMatch = Math.min(Math.max(points, 4), 99);
  }
  if (Object.keys(patch).length === 0) return c.json({ ok: true });
  patch.updatedAt = now();
  await db.update(gameSessions).set(patch).where(eq(gameSessions.id, session.id));
  if (patch.maxPlayers != null && patch.maxPlayers > session.maxPlayers) {
    await promoteWaitlist(db, { ...session, maxPlayers: patch.maxPlayers });
  }
  return c.json({ ok: true });
});

sessionRoutes.delete("/sessions/:id", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  if (!(await canManage(db, loaded.session, u))) return c.json({ error: "Organizers only" }, 403);
  await db.delete(gameSessions).where(eq(gameSessions.id, loaded.session.id));
  return c.json({ ok: true });
});

sessionRoutes.post("/sessions/:id/status", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (!(await canManage(db, session, u))) return c.json({ error: "Organizers only" }, 403);

  const body = await c.req.json().catch(() => ({}));
  const action = body.action as string;
  const setStatus = async (status: string) => {
    await db
      .update(gameSessions)
      .set({ status, updatedAt: now() })
      .where(eq(gameSessions.id, session.id));
  };

  switch (action) {
    case "open": {
      if (session.status !== "draft") return c.json({ error: "Session is already open" }, 400);
      await setStatus("open");
      return c.json({ ok: true });
    }
    case "start_checkin": {
      if (!["draft", "open"].includes(session.status)) {
        return c.json({ error: "Check-in can only start from signup" }, 400);
      }
      await setStatus("checkin");
      return c.json({ ok: true });
    }
    case "checkin_all": {
      if (session.status !== "checkin") return c.json({ error: "Not in check-in" }, 400);
      await db
        .update(sessionPlayers)
        .set({ status: "checked_in", checkedInAt: now() })
        .where(
          and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.status, "confirmed")),
        );
      return c.json({ ok: true });
    }
    case "start": {
      if (!["draft", "open", "checkin"].includes(session.status)) {
        return c.json({ error: "Session has already started" }, 400);
      }
      // Fast path: starting straight from the roster (no check-in phase) means
      // everyone the organizer confirmed is playing. From check-in, only the
      // players who actually checked in get scheduled.
      if (session.status !== "checkin") {
        await db
          .update(sessionPlayers)
          .set({ status: "checked_in", checkedInAt: now() })
          .where(
            and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.status, "confirmed")),
          );
      }
      const result = await generateNextRound(db, session);
      if (result.error) return c.json({ error: result.error }, 400);
      await setStatus("active");
      return c.json({ ok: true });
    }
    case "complete": {
      if (session.status !== "active") return c.json({ error: "Session isn't live" }, 400);
      await setStatus("complete");
      return c.json({ ok: true });
    }
    case "pause":
    case "back_to_checkin": {
      // Pausing drops back to check-in with every round and the standings kept:
      // late arrivals join with the link, drop-outs leave, and "Resume" deals the
      // next round with whoever is checked in. Only between rounds — a round
      // with scores still missing has players on court.
      if (session.status !== "active") return c.json({ error: "Session isn't live" }, 400);
      const played = await loadRounds(db, session.id);
      const latest = played[played.length - 1];
      if (latest && !latest.complete) {
        return c.json({ error: `Enter all of round ${latest.number}'s scores first` }, 400);
      }
      await setStatus("checkin");
      return c.json({ ok: true });
    }
    case "reopen": {
      if (session.status !== "complete") return c.json({ error: "Session isn't finished" }, 400);
      await setStatus("active");
      return c.json({ ok: true });
    }
    case "cancel": {
      if (session.status === "complete") return c.json({ error: "Finished sessions can't be cancelled" }, 400);
      await setStatus("cancelled");
      return c.json({ ok: true });
    }
    default:
      return c.json({ error: `Unknown action "${action}"` }, 400);
  }
});

sessionRoutes.post("/sessions/:id/players", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (!(await canManage(db, session, u))) return c.json({ error: "Organizers only" }, 403);
  if (["complete", "cancelled"].includes(session.status)) {
    return c.json({ error: "This session is over" }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const guestName = trimmed(body.guestName, 40);
  if (!guestName) return c.json({ error: "Player name is required" }, 400);
  const playing = ["checkin", "active"].includes(session.status);
  await db.insert(sessionPlayers).values({
    id: newId(),
    sessionId: session.id,
    userId: null,
    guestName,
    status: playing ? "checked_in" : "confirmed",
    joinedAt: now(),
    checkedInAt: playing ? now() : null,
  });
  return c.json({ ok: true });
});

sessionRoutes.patch("/sessions/:id/players/:pid", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (!(await canManage(db, session, u))) return c.json({ error: "Organizers only" }, 403);

  const [player] = await db
    .select()
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.id, c.req.param("pid")), eq(sessionPlayers.sessionId, session.id)))
    .limit(1);
  if (!player) return c.json({ error: "Player not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  switch (body.action as string) {
    case "checkin":
      await db
        .update(sessionPlayers)
        .set({ status: "checked_in", checkedInAt: now() })
        .where(eq(sessionPlayers.id, player.id));
      break;
    case "undo_checkin":
      await db
        .update(sessionPlayers)
        .set({ status: "confirmed", checkedInAt: null })
        .where(eq(sessionPlayers.id, player.id));
      break;
    case "drop": {
      // No history on the board → the entry simply goes away. Someone who has
      // played (or sat a round out) stays as "out" so the rounds keep their name.
      const [played] = await db
        .select({ id: matches.id })
        .from(matches)
        .where(
          and(
            eq(matches.sessionId, session.id),
            or(eq(matches.a1, player.id), eq(matches.a2, player.id), eq(matches.b1, player.id), eq(matches.b2, player.id)),
          ),
        )
        .limit(1);
      const satOut = (await loadRounds(db, session.id)).some((r) => r.byes.includes(player.id));
      if (played || satOut) {
        await db
          .update(sessionPlayers)
          .set({ status: "dropped", checkedInAt: null })
          .where(eq(sessionPlayers.id, player.id));
      } else {
        await db.delete(sessionPlayers).where(eq(sessionPlayers.id, player.id));
      }
      if (["draft", "open", "checkin"].includes(session.status)) await promoteWaitlist(db, session);
      break;
    }
    case "restore": {
      const live = ["checkin", "active"].includes(session.status);
      await db
        .update(sessionPlayers)
        .set({ status: live ? "checked_in" : "confirmed", checkedInAt: live ? now() : null })
        .where(eq(sessionPlayers.id, player.id));
      break;
    }
    case "promote":
      if (player.status !== "waitlist") return c.json({ error: "Player isn't waitlisted" }, 400);
      await db.update(sessionPlayers).set({ status: "confirmed" }).where(eq(sessionPlayers.id, player.id));
      break;
    case "set_gender":
      await db.update(sessionPlayers).set({ gender: parseGender(body.gender) }).where(eq(sessionPlayers.id, player.id));
      break;
    case "set_level":
      // Organizer-only (this route is guarded by canManage); players never set or see levels.
      await db.update(sessionPlayers).set({ level: parseLevel(body.level) }).where(eq(sessionPlayers.id, player.id));
      break;
    case "merge": {
      // "Brandon Pourmorady" (account) is the same person as guest "Brandon P":
      // the guest row keeps its history and becomes the account's row.
      const [guest] = await db
        .select()
        .from(sessionPlayers)
        .where(
          and(
            eq(sessionPlayers.id, String(body.into ?? "")),
            eq(sessionPlayers.sessionId, session.id),
            isNull(sessionPlayers.userId),
          ),
        )
        .limit(1);
      if (!guest || !player.userId) return c.json({ error: "Merge an account player into a guest entry" }, 400);
      const [played] = await db
        .select({ id: matches.id })
        .from(matches)
        .where(
          and(
            eq(matches.sessionId, session.id),
            or(eq(matches.a1, player.id), eq(matches.a2, player.id), eq(matches.b1, player.id), eq(matches.b2, player.id)),
          ),
        )
        .limit(1);
      if (played) return c.json({ error: "This player already has matches — merge the other way round" }, 400);
      await db.delete(sessionPlayers).where(eq(sessionPlayers.id, player.id));
      await db
        .update(sessionPlayers)
        .set({
          userId: player.userId,
          guestName: null,
          gender: guest.gender ?? player.gender,
          level: guest.level ?? player.level,
        })
        .where(eq(sessionPlayers.id, guest.id));
      break;
    }
    default:
      return c.json({ error: "Unknown action" }, 400);
  }
  return c.json({ ok: true });
});

// Players say whether they're a woman or a man (for mixed pairs); the organizer can override.
sessionRoutes.post("/sessions/:id/gender", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (["complete", "cancelled"].includes(session.status)) return c.json({ error: "This session is over" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const [me] = await db
    .select()
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.userId, u.id)))
    .limit(1);
  if (!me) return c.json({ error: "Join the session first" }, 400);
  await db.update(sessionPlayers).set({ gender: parseGender(body.gender) }).where(eq(sessionPlayers.id, me.id));
  return c.json({ ok: true });
});

// Self check-in: "I'm standing at the club."
sessionRoutes.post("/sessions/:id/checkin", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (!["checkin", "active"].includes(session.status)) {
    return c.json({ error: "Check-in isn't open yet" }, 400);
  }
  const [me] = await db
    .select()
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.userId, u.id)))
    .limit(1);
  if (!me) return c.json({ error: "Join the session first" }, 400);
  if (me.status === "waitlist") return c.json({ error: "You're on the waitlist — the organizer can bring you in" }, 400);
  await db
    .update(sessionPlayers)
    .set({ status: "checked_in", checkedInAt: now() })
    .where(eq(sessionPlayers.id, me.id));
  return c.json({ ok: true });
});

sessionRoutes.post("/sessions/:id/leave", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (!["draft", "open", "checkin"].includes(session.status)) {
    return c.json({ error: "The session has started — ask the organizer to remove you" }, 400);
  }
  const [me] = await db
    .select()
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.userId, u.id)))
    .limit(1);
  if (!me) return c.json({ error: "You're not in this session" }, 400);
  await db
    .update(sessionPlayers)
    .set({ status: "dropped", checkedInAt: null })
    .where(eq(sessionPlayers.id, me.id));
  await promoteWaitlist(db, session);
  return c.json({ ok: true });
});

sessionRoutes.post("/sessions/:id/rounds", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (!(await canManage(db, session, u))) return c.json({ error: "Organizers only" }, 403);
  if (session.status !== "active") return c.json({ error: "Session isn't live" }, 400);

  const body = await c.req.json().catch(() => ({}));
  let force = body.force === true;

  if (body.regenerate === true) {
    const played = await loadRounds(db, session.id);
    const latest = played[played.length - 1];
    if (!latest) return c.json({ error: "No round to regenerate" }, 400);
    if (latest.matches.some((m) => m.status === "confirmed")) {
      return c.json({ error: "Scores are already confirmed this round — undo the round instead" }, 400);
    }
    await db.delete(rounds).where(eq(rounds.id, latest.id));
    force = true; // earlier rounds were already validated when this one was generated
  }

  const result = await generateNextRound(db, session, { force });
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json({ ok: true, roundNumber: result.roundNumber });
});

sessionRoutes.delete("/sessions/:id/rounds/:roundId", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (!(await canManage(db, session, u))) return c.json({ error: "Organizers only" }, 403);

  const roundRows = await db
    .select()
    .from(rounds)
    .where(eq(rounds.sessionId, session.id))
    .orderBy(rounds.number);
  const latest = roundRows[roundRows.length - 1];
  if (!latest || latest.id !== c.req.param("roundId")) {
    return c.json({ error: "Only the latest round can be undone" }, 400);
  }
  await db.delete(rounds).where(eq(rounds.id, latest.id));
  return c.json({ ok: true });
});
