import { fitCourtLabels, parseCourtLabels } from "../../shared/courts";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { gameSessions, groupMembers, matches, rounds, sessionPlayers, user } from "../db/schema";
import type { DB, SessionRow } from "../lib/detail";
import { buildDetail, isGroupMember, isGroupOrganizer, loadRounds, loadSession, loadTracks } from "../lib/detail";
import { beginnerCourtActive, dropUnplayedUpNext, dropUnscoredBeginnerGame, generateNextRound, keepBeginnerGame, keepUpNext, redealUpNext } from "../lib/engine";
import { getFormat } from "../../shared/formats/registry";
import { beginnerCourtOf } from "../../shared/formats/pools";
import { normalizeDropAfter } from "../../shared/drop";
import { newbieSpotsLeft, normalizeNewbieCap, promotable } from "../../shared/newbieCap";
import { parseGender } from "../../shared/genders";
import { isNewbie, normalizeLevel, parseLevel } from "../../shared/levels";
import { TEST_BATCH, TEST_PLAYERS, nextTestPlayers } from "../../shared/testPlayers";
import { pickReplacement, swapInRound, swapTeamsInRound, waitingToStart } from "../../shared/swap";
import type { RoundRow } from "../../shared/types";
import { asInt, newId, now, trimmed } from "../lib/util";
import type { ApiCtx, AuthedUser } from "./context";

export const sessionRoutes = new Hono<ApiCtx>();

async function canManage(db: DB, session: SessionRow, u: AuthedUser | null): Promise<boolean> {
  if (!u) return false;
  // Admins run every tournament; crew organizers (hidden today) keep theirs.
  return u.isAdmin || session.createdBy === u.id || (await isGroupOrganizer(db, session.groupId, u.id));
}

/** Fill freed confirmed spots from the waitlist, oldest joiners first. */
async function promoteWaitlist(db: DB, session: SessionRow): Promise<void> {
  const players = await db
    .select()
    .from(sessionPlayers)
    .where(eq(sessionPlayers.sessionId, session.id));
  // A waitlisted newbie only comes in while a newbie place is open (the cap).
  for (const p of promotable(players, session.maxPlayers, newbieSpotsLeft(session, players))) {
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

  return c.json(await buildDetail(db, session, groupName, u.id, groupIsPersonal, u.isAdmin));
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
  // Rented court names ("3, 4") set the count; a new count alone keeps the names in step.
  const courts = asInt(body.courts);
  if (courts != null) patch.courts = Math.min(Math.max(courts, 1), 12);
  if ("courtLabels" in body) {
    const labels = parseCourtLabels(body.courtLabels);
    patch.courtLabels = labels.length ? labels.join(",") : null;
    if (labels.length) patch.courts = labels.length;
  } else if (patch.courts != null && session.courtLabels) {
    patch.courtLabels = fitCourtLabels(parseCourtLabels(session.courtLabels), patch.courts).join(",");
  }
  // Casual ↔ competitive can flip any time before the session is over; the
  // next round dealt uses the new strategy.
  if (typeof body.format === "string" && !["complete", "cancelled"].includes(session.status)) {
    const format = getFormat(body.format);
    if (!format) return c.json({ error: `Unknown format "${body.format}"` }, 400);
    patch.format = format.key;
  }
  if (typeof body.mixedPairs === "boolean") patch.mixedPairs = body.mixedPairs;
  if (typeof body.groupByLevel === "boolean") patch.groupByLevel = body.groupByLevel;
  // The beginner court and competitive sit-outs apply from the next round dealt.
  if (typeof body.beginnerCourt === "boolean") patch.beginnerCourt = body.beginnerCourt;
  // Games court ↔ coached court (newbies train with a coach, out of the draw): also from the next round dealt.
  if (typeof body.beginnerCourtCoached === "boolean") patch.beginnerCourtCoached = body.beginnerCourtCoached;
  // Which court is the beginner court: kept within the courts the session has (fewer courts → clamped).
  const courtsAfter = patch.courts ?? session.courts;
  const beginnerCourtNo = asInt(body.beginnerCourtNo);
  if (beginnerCourtNo != null || (patch.courts != null && session.beginnerCourtNo > courtsAfter)) {
    patch.beginnerCourtNo = beginnerCourtOf({ beginnerCourtNo: beginnerCourtNo ?? session.beginnerCourtNo, courts: courtsAfter });
  }
  if (typeof body.competitiveSitouts === "boolean") patch.competitiveSitouts = body.competitiveSitouts;
  // The newbie cap (null = no limit): for sign-ups from now on; nobody already in is moved.
  if ("maxNewbies" in body) patch.maxNewbies = normalizeNewbieCap(body.maxNewbies);
  // The drop round: sit-outs rotate fairly up to it; from the next round dealt after it, the table decides.
  if (asInt(body.competitiveAfterRound) != null) patch.competitiveAfterRound = normalizeDropAfter(asInt(body.competitiveAfterRound));

  // Max players can change any time (extra people turn up mid-session). The
  // points per game lock once a score is in, since every score on the board
  // adds up to that total.
  const maxPlayers = asInt(body.maxPlayers);
  if (maxPlayers != null) patch.maxPlayers = Math.min(Math.max(maxPlayers, 4), 64);
  const points = asInt(body.pointsPerMatch);
  const teamsChange = typeof body.fixedTeams === "boolean" && body.fixedTeams !== session.fixedTeams;
  if (points != null && points !== session.pointsPerMatch) {
    const tracks = await loadTracks(db, session.id);
    const scored = [...tracks.main, ...tracks.beginner].some((r) => r.matches.some((m) => m.scoreA != null));
    if (scored) return c.json({ error: "Points per game can't change once a score is in — undo those rounds first" }, 400);
    patch.pointsPerMatch = Math.min(Math.max(points, 4), 99);
  }
  // Teams can be kept together (or not) from the next round on: team standings
  // count each pair's games together, individual standings every game.
  if (teamsChange) patch.fixedTeams = body.fixedTeams;
  if (Object.keys(patch).length === 0) return c.json({ ok: true });
  patch.updatedAt = now();
  await db.update(gameSessions).set(patch).where(eq(gameSessions.id, session.id));
  if (patch.maxPlayers != null && patch.maxPlayers > session.maxPlayers) {
    await promoteWaitlist(db, { ...session, maxPlayers: patch.maxPlayers });
  }
  // The beginner court changed under its game in waiting (another court, coaching, switched off, teams):
  // that game is re-dealt under the new settings, or dropped. A game with a score on it stays.
  const courtChanged = ["beginnerCourt", "beginnerCourtNo", "beginnerCourtCoached", "courts", "fixedTeams"].some(
    (k) => k in patch && (patch as Record<string, unknown>)[k] !== (session as Record<string, unknown>)[k],
  );
  if (courtChanged && session.status === "active" && (await dropUnscoredBeginnerGame(db, session.id))) {
    await keepBeginnerGame(db, { ...session, ...patch } as SessionRow);
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
    // Finals: for the last part of the night the top of the table plays and the rest sit.
    // The round on deck was dealt under the other rule, so it's dealt again (unless a score is on it).
    case "finals_on":
    case "finals_off": {
      if (session.status !== "active") return c.json({ error: "Session isn't live" }, 400);
      if (session.fixedTeams) return c.json({ error: "Finals aren't available with Keep teams together" }, 400);
      const finals = action === "finals_on";
      if (finals === session.finals) return c.json({ ok: true });
      await db.update(gameSessions).set({ finals, updatedAt: now() }).where(eq(gameSessions.id, session.id));
      const dealt = await loadRounds(db, session.id);
      const onDeck = dealt[dealt.length - 1];
      const inPlay = dealt[dealt.length - 2];
      if (onDeck && inPlay && !inPlay.complete && onDeck.matches.every((m) => m.scoreA == null && m.status === "pending")) {
        await db.delete(rounds).where(eq(rounds.id, onDeck.id));
      }
      await keepUpNext(db, { ...session, finals });
      return c.json({ ok: true });
    }
    case "start": {
      if (!["draft", "open", "checkin"].includes(session.status)) {
        return c.json({ error: "Session has already started" }, 400);
      }
      // No check-in step: everyone still on the roster plays (no-shows get ✕'d),
      // whether starting or resuming a paused game.
      await db
        .update(sessionPlayers)
        .set({ status: "checked_in", checkedInAt: now() })
        .where(
          and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.status, "confirmed")),
        );
      const result = await generateNextRound(db, session);
      if (result.error) return c.json({ error: result.error }, 400);
      await setStatus("active");
      // On deck: the next round is dealt straight away too.
      await keepUpNext(db, { ...session, status: "active" });
      return c.json({ ok: true });
    }
    case "complete": {
      if (session.status !== "active") return c.json({ error: "Session isn't live" }, 400);
      await dropUnplayedUpNext(db, session.id);
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
      // A round dealt ahead can leave an earlier round's court still playing.
      const open = (await loadRounds(db, session.id)).find((r) => !r.complete);
      if (open) {
        return c.json({ error: `Enter all of round ${open.number}'s scores first` }, 400);
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
  const playing = ["checkin", "active"].includes(session.status);

  // A registered member, picked from the suggestions as the organizer typed: their own account goes on the
  // roster with the level and gender from their profile — the same entry they'd get by joining from the link.
  if (typeof body.userId === "string") {
    if (!u.isAdmin) return c.json({ error: "Admins only" }, 403);
    const [member] = await db.select().from(user).where(eq(user.id, body.userId)).limit(1);
    if (!member) return c.json({ error: "That member no longer exists" }, 404);
    const level = normalizeLevel(member.level);
    const [existing] = await db
      .select()
      .from(sessionPlayers)
      .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.userId, member.id)))
      .limit(1);
    if (existing && existing.status !== "dropped") return c.json({ error: `${member.name || member.email} is already on the roster` }, 400);
    const status = playing ? "checked_in" : "confirmed";
    const newbie = body.newbie === true || isNewbie(level);
    if (existing) {
      await db.update(sessionPlayers).set({ status, joinedAt: now(), checkedInAt: playing ? now() : null }).where(eq(sessionPlayers.id, existing.id));
    } else {
      await db.insert(sessionPlayers).values({
        id: newId(),
        sessionId: session.id,
        userId: member.id,
        guestName: null,
        status,
        joinedAt: now(),
        checkedInAt: playing ? now() : null,
        gender: parseGender(member.gender),
        level,
        newbie,
      });
    }
    // On the roster means part of its crew, exactly as joining from the link does: the tournament shows on their home screen.
    const [membership] = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, session.groupId), eq(groupMembers.userId, member.id)))
      .limit(1);
    if (!membership) {
      await db.insert(groupMembers).values({ id: newId(), groupId: session.groupId, userId: member.id, role: "member", createdAt: now() });
    }
    if (newbie) await keepBeginnerGame(db, session);
    return c.json({ ok: true });
  }

  const guestName = trimmed(body.guestName, 40);
  if (!guestName) return c.json({ error: "Player name is required" }, 400);
  await db.insert(sessionPlayers).values({
    id: newId(),
    sessionId: session.id,
    userId: null,
    guestName,
    status: playing ? "checked_in" : "confirmed",
    joinedAt: now(),
    checkedInAt: playing ? now() : null,
    newbie: body.newbie === true,
  });
  // A fourth newbie arriving is what the beginner court was waiting for.
  if (body.newbie === true) await keepBeginnerGame(db, session);
  return c.json({ ok: true });
});

// A dry run's roster in one tap: stand-in players with a mix of genders and
// levels (src/shared/testPlayers.ts). Roster guests only — no accounts, no
// emails. A stand-in at Newbie level is tagged for the beginner court, as a
// real Newbie joining would be. Each call adds the next ones not on the roster.
sessionRoutes.post("/sessions/:id/test-players", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (!(await canManage(db, session, u))) return c.json({ error: "Organizers only" }, 403);
  if (["complete", "cancelled"].includes(session.status)) return c.json({ error: "This session is over" }, 400);

  const body = await c.req.json().catch(() => ({}));
  const roster = await db.select().from(sessionPlayers).where(eq(sessionPlayers.sessionId, session.id));
  const live = roster.filter((p) => p.status !== "dropped");
  // One named stand-in (picked from the suggestions), or the next batch.
  const wanted = typeof body.name === "string" ? body.name.trim().toLowerCase() : null;
  const available = nextTestPlayers(live.map((p) => p.guestName), TEST_PLAYERS.length);
  const add = wanted ? available.filter((t) => t.name.toLowerCase() === wanted) : available.slice(0, asInt(body.count) ?? TEST_BATCH);
  if (add.length === 0) {
    return c.json({ error: wanted ? "That test player is already on the roster" : "All the test players are already on the roster" }, 400);
  }

  const playing = ["checkin", "active"].includes(session.status);
  const ts = now();
  const rows = add.map((t, i) => ({
    id: newId(),
    sessionId: session.id,
    userId: null,
    guestName: t.name,
    status: playing ? "checked_in" : "confirmed",
    joinedAt: ts + i,
    checkedInAt: playing ? ts : null,
    gender: t.gender,
    level: t.level,
    newbie: isNewbie(t.level),
  }));
  // D1 caps a statement at 100 bound parameters: a few rows per insert, batched so it's all or nothing.
  const inserts = [];
  for (let i = 0; i < rows.length; i += 8) inserts.push(db.insert(sessionPlayers).values(rows.slice(i, i + 8)));
  await db.batch(inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]]);
  if (rows.some((r) => r.newbie)) await keepBeginnerGame(db, session);
  return c.json({ ok: true, added: rows.length });
});

/** Clears the fixed-partner links of these players, on both sides. */
const unpairQuery = (db: DB, sessionId: string, ids: string[]) =>
  db
    .update(sessionPlayers)
    .set({ partnerId: null })
    .where(and(eq(sessionPlayers.sessionId, sessionId), or(inArray(sessionPlayers.id, ids), inArray(sessionPlayers.partnerId, ids))));

async function unpair(db: DB, sessionId: string, ids: string[]): Promise<void> {
  if (ids.length > 0) await unpairQuery(db, sessionId, ids);
}

/**
 * Move a player to the beginner court (tag) or back up to the tournament (untag).
 *
 * Live, with the beginner court set aside, a player moved down comes off every
 * main game that hasn't been played: the round up next is dealt again without
 * them when none of its games can have started; otherwise the player who has
 * waited most takes their place. A game that is on court now is only touched
 * when the organizer says so (`now`) — the app can't see whether it has begun.
 * Moved up, they're dealt into the round up next the same way.
 */
async function moveCourts(db: DB, session: SessionRow, playerId: string, newbie: boolean, now: boolean): Promise<void> {
  await db.update(sessionPlayers).set({ newbie }).where(eq(sessionPlayers.id, playerId));
  if (session.status !== "active") return;
  if (!newbie) {
    // Moved up while on court in the beginner court's game in waiting: that game is re-dealt without them
    // (unless a score is already on it). Anyone else's game is left alone — it may be mid-play.
    const { beginner } = await loadTracks(db, session.id);
    const waiting = beginner[beginner.length - 1];
    const onIt = !!waiting && !waiting.complete && waiting.matches.some((m) => [...m.a, ...m.b].includes(playerId));
    if (onIt) await dropUnscoredBeginnerGame(db, session.id);
    if (!session.fixedTeams) await redealUpNext(db, session);
  } else if (await beginnerCourtActive(db, session)) {
    await pullFromMainDraw(db, session, playerId, now);
  }
  // Tagging can make the fourth newbie the beginner court was waiting for; untagging frees a place.
  await keepBeginnerGame(db, session);
}

/** Take a player who's just moved to the beginner court off the main games that haven't been played. */
async function pullFromMainDraw(db: DB, session: SessionRow, playerId: string, now: boolean): Promise<void> {
  const roster = await db.select().from(sessionPlayers).where(eq(sessionPlayers.sessionId, session.id));
  const swapOut = async (round: RoundRow, all: RoundRow[]): Promise<void> => {
    const games: Record<string, number> = {};
    const sitOuts: Record<string, number> = {};
    for (const r of all) {
      for (const p of r.byes) sitOuts[p] = (sitOuts[p] ?? 0) + 1;
      for (const m of r.matches) for (const p of [...m.a, ...m.b]) games[p] = (games[p] ?? 0) + 1;
    }
    const inDraw = (id: string) => roster.some((p) => p.id === id && p.status === "checked_in" && !p.newbie);
    const inn = pickReplacement({
      sitters: round.byes.filter(inDraw),
      out: playerId,
      games,
      sitOuts,
      genders: Object.fromEntries(roster.map((p) => [p.id, p.gender])),
      mixedPairs: session.mixedPairs,
    });
    if (!inn) return; // nobody sitting to take the place: the game stays as dealt
    const slots = round.matches.map((m) => ({
      id: m.id,
      slots: [m.a[0], m.a[1], m.b[0], m.b[1]] as [string, string, string, string],
      scored: m.scoreA != null || m.status !== "pending",
    }));
    const result = swapInRound(slots, round.byes, playerId, inn);
    if ("error" in result) return;
    for (const m of result.matches) {
      const [a1, a2, b1, b2] = m.slots;
      await db.update(matches).set({ a1, a2, b1, b2 }).where(eq(matches.id, m.id));
    }
    // They aren't sitting the round out either: they're on the beginner court now.
    await db.update(rounds).set({ byesJson: JSON.stringify(result.byes.filter((p) => p !== playerId)) }).where(eq(rounds.id, round.id));
  };
  const state = async () => {
    const all = await loadRounds(db, session.id);
    const latest = all[all.length - 1];
    const before = all[all.length - 2];
    const dealtAhead = !!before && !before.complete;
    return { all, playing: dealtAhead ? before : latest, upNext: dealtAhead ? latest : undefined };
  };
  const gameOf = (round: RoundRow | undefined) =>
    round?.matches.find((m) => m.scoreA == null && m.status === "pending" && [...m.a, ...m.b].includes(playerId));
  const live = (round: RoundRow) => round.matches.map((m) => ({ court: m.court, players: [...m.a, ...m.b], finished: m.status === "confirmed" }));

  // The game on court now: only when the organizer said to take them off it.
  let { all, playing, upNext } = await state();
  if (playing && gameOf(playing) && now) await swapOut(playing, all);
  // The round up next: dealt again without them when nothing in it can have started…
  if (await redealUpNext(db, session)) return;
  // …otherwise just their own game changes — on the organizer's say-so if it may already be on court.
  ({ all, playing, upNext } = await state());
  const next = gameOf(upNext);
  if (upNext && playing && next) {
    const waiting = waitingToStart(live(playing), { court: next.court, players: [...next.a, ...next.b] });
    if (waiting || now) await swapOut(upNext, all);
  }
  // Listed as sitting a main round they're no longer part of: off that list too.
  for (const round of [playing, upNext]) {
    if (round && !round.complete && round.byes.includes(playerId) && !gameOf(round)) {
      await db.update(rounds).set({ byesJson: JSON.stringify(round.byes.filter((p) => p !== playerId)) }).where(eq(rounds.id, round.id));
    }
  }
}

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
      await unpair(db, session.id, [player.id]); // their partner is paired again next round
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
    case "set_partner": {
      // Keep teams together: link both rows (each side's previous partner becomes unpaired).
      const partnerId = typeof body.partnerId === "string" && body.partnerId ? body.partnerId : null;
      if (partnerId === player.id) return c.json({ error: "Pick someone else" }, 400);
      let partner: typeof player | undefined;
      if (partnerId) {
        [partner] = await db
          .select()
          .from(sessionPlayers)
          .where(and(eq(sessionPlayers.id, partnerId), eq(sessionPlayers.sessionId, session.id)))
          .limit(1);
        if (!partner) return c.json({ error: "Player not found" }, 404);
        if (partner.status === "dropped") return c.json({ error: "That player has left" }, 400);
      }
      // One batch (one transaction), so two quick changes can't leave a one-sided link.
      const clear = unpairQuery(db, session.id, partner ? [player.id, partner.id] : [player.id]);
      if (partner) {
        await db.batch([
          clear,
          db.update(sessionPlayers).set({ partnerId: partner.id }).where(eq(sessionPlayers.id, player.id)),
          db.update(sessionPlayers).set({ partnerId: player.id }).where(eq(sessionPlayers.id, partner.id)),
        ]);
      } else {
        await clear;
      }
      break;
    }
    case "set_level": {
      // The organizer can set or override anyone's level (players set their own via /level).
      const level = parseLevel(body.level);
      await db.update(sessionPlayers).set({ level }).where(eq(sessionPlayers.id, player.id));
      // Newbie is the level that plays the beginner court, so the organizer's change moves the player
      // with it: down when set to Newbie, back up when a Newbie is set to anything else.
      if (isNewbie(level) && !player.newbie) await moveCourts(db, session, player.id, true, body.now === true);
      else if (isNewbie(player.level) && !isNewbie(level) && player.newbie) await moveCourts(db, session, player.id, false, false);
      break;
    }
    case "set_newbie":
      // Move down (tag) / move up (untag).
      await moveCourts(db, session, player.id, body.newbie === true, body.now === true);
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
      // A partner chosen for the account entry moves to the guest entry (unless it already has one).
      const takePartner = !guest.partnerId && player.partnerId ? player.partnerId : null;
      await db
        .update(sessionPlayers)
        .set({
          userId: player.userId,
          guestName: null,
          gender: guest.gender ?? player.gender,
          level: guest.level ?? player.level,
          partnerId: guest.partnerId ?? takePartner,
        })
        .where(eq(sessionPlayers.id, guest.id));
      if (player.partnerId) {
        await db
          .update(sessionPlayers)
          .set({ partnerId: takePartner ? guest.id : null })
          .where(and(eq(sessionPlayers.id, player.partnerId), eq(sessionPlayers.partnerId, player.id)));
      }
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

// Players rate their own level (private: only they and the organizer see it); the organizer can override.
sessionRoutes.post("/sessions/:id/level", async (c) => {
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
  await db.update(sessionPlayers).set({ level: parseLevel(body.level) }).where(eq(sessionPlayers.id, me.id));
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
  await unpair(db, session.id, [me.id]);
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
  // The beginner court's own game: reshuffle the one waiting for a score, or deal one if the court is idle.
  if (body.beginner === true && body.next === true) {
    // "Next game" on a coached-style beginner court: the four on court are done, nobody kept score.
    // The game counts for the rotation (who has played, who has waited) and the next one is dealt.
    const { beginner } = await loadTracks(db, session.id);
    const current = beginner[beginner.length - 1];
    if (current && !current.complete) {
      if (current.matches.some((m) => m.scoreA != null || m.status !== "pending")) {
        return c.json({ error: "That game has a score coming in — confirm or correct it instead" }, 400);
      }
      await db.update(matches).set({ status: "skipped" }).where(eq(matches.roundId, current.id));
    }
    await keepBeginnerGame(db, session);
    return c.json({ ok: true });
  }
  if (body.beginner === true) {
    if (!(await dropUnscoredBeginnerGame(db, session.id))) {
      return c.json({ error: "That game already has a score — enter or correct it instead" }, 400);
    }
    await keepBeginnerGame(db, session);
    return c.json({ ok: true });
  }
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
  await keepUpNext(db, session);
  return c.json({ ok: true, roundNumber: result.roundNumber });
});

// Swap one player for another in a game without a score yet — in the round
// being played or the one dealt up next: someone sitting out, someone on
// another court, or a late arrival.
sessionRoutes.post("/sessions/:id/rounds/:roundId/swap", async (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "Sign in required" }, 401);
  const db = c.get("db");
  const loaded = await loadSession(db, c.req.param("id"));
  if (!loaded) return c.json({ error: "Session not found" }, 404);
  const { session } = loaded;
  if (!(await canManage(db, session, u))) return c.json({ error: "Organizers only" }, 403);
  if (session.status !== "active") return c.json({ error: "Session isn't live" }, 400);

  const body = await c.req.json().catch(() => ({}));
  const out = typeof body.out === "string" ? body.out : "";
  const inn = typeof body.in === "string" ? body.in : "";
  const played = await loadRounds(db, session.id);
  // Either of the two live rounds can change: the one up next, or the one still being played before it.
  const newest = played[played.length - 1];
  const inPlay = played[played.length - 2];
  const roundId = c.req.param("roundId");
  const latest = newest?.id === roundId ? newest : inPlay && !inPlay.complete && inPlay.id === roundId ? inPlay : null;
  if (!latest) {
    return c.json({ error: "Only the round being played or the one up next can change" }, 400);
  }
  const roster = await db.select().from(sessionPlayers).where(eq(sessionPlayers.sessionId, session.id));
  const inRound = (id: string) => latest.byes.includes(id) || latest.matches.some((m) => [...m.a, ...m.b].includes(id));
  const playing = (id: string) => inRound(id) || roster.find((p) => p.id === id)?.status === "checked_in";
  // Keep teams together: the whole team swaps. A player's team is their side of a
  // game this round, else their partner on the roster.
  const teammate = (id: string): string | null => {
    for (const m of latest.matches) {
      for (const side of [m.a, m.b]) if (side.includes(id)) return side.find((x) => x !== id) ?? null;
    }
    return roster.find((p) => p.id === id)?.partnerId ?? null;
  };
  const ins = session.fixedTeams ? [inn, teammate(inn)] : [inn];
  if (ins.some((id) => !id || !playing(id))) {
    return c.json({ error: session.fixedTeams ? "That team isn't both here tonight" : "That player isn't playing tonight" }, 400);
  }
  // Beginner court: the pools don't mix — move the player across (the Newbie tag) instead.
  if (await beginnerCourtActive(db, session)) {
    const isNewbie = (id: string) => !!roster.find((p) => p.id === id)?.newbie;
    if (isNewbie(out) !== isNewbie(inn)) {
      return c.json({ error: "Newbies and ladder players don't swap courts — change the player's Newbie tag to move them across" }, 400);
    }
  }

  const slots = latest.matches.map((m) => ({
    id: m.id,
    slots: [m.a[0], m.a[1], m.b[0], m.b[1]] as [string, string, string, string],
    scored: m.scoreA != null || m.status !== "pending",
  }));
  let result;
  if (session.fixedTeams) {
    const outMate = teammate(out);
    if (!outMate) return c.json({ error: "That player isn't on a court this round" }, 400);
    if (outMate === inn) return c.json({ error: "They're already on the same team" }, 400);
    result = swapTeamsInRound(slots, latest.byes, [out, outMate], [inn, ins[1]!]);
  } else {
    result = swapInRound(slots, latest.byes, out, inn);
  }
  if ("error" in result) return c.json({ error: result.error }, 400);
  for (const m of result.matches) {
    const [a1, a2, b1, b2] = m.slots;
    await db.update(matches).set({ a1, a2, b1, b2 }).where(eq(matches.id, m.id));
  }
  await db
    .update(rounds)
    .set({ byesJson: JSON.stringify(result.byes) })
    .where(eq(rounds.id, latest.id));
  return c.json({ ok: true });
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
  // Each sequence undoes from its own end: the latest main round, or the beginner court's latest game.
  const target = roundRows.find((r) => r.id === c.req.param("roundId"));
  const sameTrack = roundRows.filter((r) => (r.track === "beginner") === (target?.track === "beginner"));
  const latest = sameTrack[sameTrack.length - 1];
  if (!target || !latest || latest.id !== target.id) {
    return c.json({ error: "Only the latest round can be undone" }, 400);
  }
  await db.delete(rounds).where(eq(rounds.id, latest.id));
  return c.json({ ok: true });
});
