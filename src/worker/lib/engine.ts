import { eq } from "drizzle-orm";
import { getFormat } from "../../shared/formats/registry";
import { BEGINNER_TRACK_BASE, beginnerCourtOf, coachedActive, planBeginnerGame, planCoached, poolRounds, poolsActive } from "../../shared/formats/pools";
import { autoPair } from "../../shared/formats/teams";
import type { EngineContext, PlannedMatch } from "../../shared/formats/types";
import type { MatchRow, RoundRow } from "../../shared/types";
import { buildHistory, creditAbsences } from "../../shared/history";
import { computeStandings, rankForCourts } from "../../shared/standings";
import { normalizeLevel } from "../../shared/levels";
import { dropOn, normalizeDropAfter } from "../../shared/drop";
import { matches, playerResults, rounds, sessionPlayers } from "../db/schema";
import type { DB, SessionRow } from "./detail";
import { loadRounds, loadTracks } from "./detail";
import { newId, now } from "./util";

export interface GenerateResult {
  error?: string;
  roundNumber?: number;
}

/** Generate the next round for a live session using its format strategy. */
export async function generateNextRound(
  db: DB,
  session: SessionRow,
  opts: { force?: boolean } = {},
): Promise<GenerateResult> {
  const format = getFormat(session.format);
  if (!format) return { error: `Unknown format "${session.format}".` };

  // Roster order (who joined first), as the session page shows it: the odd player out is the last to join.
  const players = (await db.select().from(sessionPlayers).where(eq(sessionPlayers.sessionId, session.id))).sort(
    (a, b) => a.joinedAt - b.joinedAt,
  );
  // Beginner court set aside — coaching, or its own games on its own clock: the
  // players tagged Newbie aren't in the main draw, and that court isn't dealt here.
  const { coached, pools, newbies } = beginnerCourtState(session, players);
  const setAside = coached || pools;
  const tagged = new Set(newbies);
  const eligible = players.filter((p) => p.status === "checked_in" && !(setAside && tagged.has(p.id))).map((p) => p.id);
  const levels: Record<string, number> = {};
  const genders: Record<string, "woman" | "man"> = {};
  for (const p of players) {
    // Levels deal courts only when the session groups by level (and balance auto-paired teams).
    const level = normalizeLevel(p.level);
    if (level != null) levels[p.id] = level;
    if (p.gender === "woman" || p.gender === "man") genders[p.id] = p.gender;
  }
  if (eligible.length < format.minPlayers) {
    return { error: `${format.name} needs at least ${format.minPlayers} checked-in players (currently ${eligible.length}).` };
  }

  const played = await loadRounds(db, session.id);
  const latest = played[played.length - 1];
  if (latest && !latest.complete && !opts.force) {
    return { error: "The current round still has unconfirmed scores. Confirm them first, or force-generate." };
  }
  // Dealing ahead: the next round can start while a court is still finishing,
  // but only one round can be finishing at a time.
  const before = played[played.length - 2];
  if (latest && !latest.complete && before && !before.complete) {
    return { error: `Round ${before.number} is still finishing — enter its last score first.` };
  }
  const finishing = latest && !latest.complete ? latest.matches.filter((m) => m.status !== "confirmed") : [];

  // Late arrivals are credited for the rounds they missed, so they join the rotation.
  const history = creditAbsences(buildHistory(played), played, eligible);
  const beginnerCourt = beginnerCourtOf(session);
  // Ranked formats deal courts from points per match played (bye-adjusted) — the ladder's own games only.
  const ranked = rankForCourts(
    computeStandings(players.map((p) => ({ id: p.id, name: p.id })), setAside ? poolRounds(played, "ladder", beginnerCourt) : played),
  ).filter((r) => r.played > 0);

  const roundNumber = (latest?.number ?? 0) + 1;
  const ctx: EngineContext = {
    players: eligible,
    courts: session.courts,
    roundNumber,
    ...history,
    standings: ranked.map((r) => ({ playerId: r.playerId, points: r.points, diff: r.diff, played: r.played })),
    levels: session.groupByLevel ? levels : undefined,
    groupByLevel: session.groupByLevel,
    genders,
    mixedPairs: session.mixedPairs,
    busy: finishing.length ? finishing.flatMap((m) => [...m.a, ...m.b]) : undefined,
    // The drop: fair sit-outs up to the organizer's round, the table decides after it.
    competitive: session.competitiveSitouts && dropOn(normalizeDropAfter(session.competitiveAfterRound), roundNumber),
    finals: session.finals,
    rng: Math.random,
  };
  if (session.fixedTeams) ctx.teams = await fixTeams(db, players, eligible, { ...ctx, levels });

  // The newbies are already out of `eligible`; planCoached keeps the draw off the beginner court.
  const plan = setAside ? planCoached(ctx, format, [], beginnerCourt) : format.planRound(ctx);
  if (plan.matches.length === 0) {
    if (session.fixedTeams) {
      return { error: "Keep teams together needs two full teams checked in — check in both partners, or change the pairings." };
    }
    return { error: "Not enough players to fill a court." };
  }

  if (latest && finishing.length) {
    plan.matches = courtsWhenDealtAhead(plan.matches, latest.matches, ctx.courts, setAside ? beginnerCourt : 0);
  }

  const ts = now();
  const roundId = newId();
  await db.insert(rounds).values({
    id: roundId,
    sessionId: session.id,
    number: ctx.roundNumber,
    byesJson: JSON.stringify(plan.byes),
    track: "main",
    createdAt: ts,
  });
  await db.insert(matches).values(
    plan.matches.map((m) => ({
      id: newId(),
      sessionId: session.id,
      roundId,
      court: m.court,
      a1: m.a[0],
      a2: m.a[1],
      b1: m.b[0],
      b2: m.b[1],
      status: "pending" as const,
    })),
  );
  return { roundNumber: ctx.roundNumber };
}

/**
 * Dealing ahead: courts whose players are all free take the courts that just
 * came free (they start now); a court waiting for players still finishing a
 * game takes the court those players are on (it starts when they're done).
 */
/**
 * On deck: while a round is being played, the round after it is already dealt,
 * so the players sitting out can stand by at their court and everyone on court
 * knows where they're headed next. Called at the start and after every score:
 * once the round before the one on deck is fully scored, the next one is dealt.
 * In Competitive that places the round on deck from the standings one round
 * back — the price of knowing every court before the round in play ends.
 */
export async function keepUpNext(db: DB, session: SessionRow): Promise<void> {
  if (session.status !== "active") return;
  await keepMainUpNext(db, session);
  // The beginner court runs on its own clock: its next game is dealt as soon as its last one is scored.
  await keepBeginnerGame(db, session);
}

async function keepMainUpNext(db: DB, session: SessionRow): Promise<void> {
  const played = await loadRounds(db, session.id);
  const latest = played[played.length - 1];
  const before = played[played.length - 2];
  if (!latest) return;
  if (before && !before.complete) {
    // Already one round on deck: a court that just finished frees up, so a game
    // whose four are all standing by moves onto it (nothing's played yet).
    await recourtUpNext(db, before, latest, session.courts, (await beginnerCourtActive(db, session)) ? beginnerCourtOf(session) : 0);
    return;
  }
  try {
    await generateNextRound(db, session, { force: true });
  } catch {
    // Two scores landing together both try to deal the same round number: one wins.
  }
}

type RosterRow = typeof sessionPlayers.$inferSelect;

/** How the beginner court stands tonight: coached, running its own games (`pools`), or neither — and who's tagged and here. */
export function beginnerCourtState(session: SessionRow, players: RosterRow[]): { coached: boolean; pools: boolean; newbies: string[] } {
  const here = players.filter((p) => p.status === "checked_in");
  const newbies = here.filter((p) => p.newbie).map((p) => p.id);
  const coached = coachedActive({ beginnerCourt: session.beginnerCourt, coached: session.beginnerCourtCoached, fixedTeams: session.fixedTeams, courts: session.courts });
  const pools =
    !coached &&
    poolsActive({ beginnerCourt: session.beginnerCourt, fixedTeams: session.fixedTeams, courts: session.courts, eligible: here.length, newbies: newbies.length });
  return { coached, pools, newbies };
}

/** Whether the beginner court is set aside tonight: coached, or running its own games. */
export async function beginnerCourtActive(db: DB, session: SessionRow): Promise<boolean> {
  if (!session.beginnerCourt || session.fixedTeams) return false;
  const players = await db.select().from(sessionPlayers).where(eq(sessionPlayers.sessionId, session.id));
  const { coached, pools } = beginnerCourtState(session, players);
  return coached || pools;
}

/**
 * The beginner court's own games. One at a time: when the court has no game
 * waiting for a score, the next is dealt from the newbies who are here —
 * Americano rotation over the beginner track's own history. Called after
 * every score and every main deal, so the court keeps itself going without
 * ever being part of a main round.
 *
 * Nothing is dealt while a main game is still being played on that court, and
 * a newbie still finishing a main game (just tagged) joins from the next one.
 */
export async function keepBeginnerGame(db: DB, session: SessionRow): Promise<void> {
  if (session.status !== "active") return;
  const players = (await db.select().from(sessionPlayers).where(eq(sessionPlayers.sessionId, session.id))).sort(
    (a, b) => a.joinedAt - b.joinedAt,
  );
  const { pools, newbies } = beginnerCourtState(session, players);
  if (!pools) return;
  const { main, beginner: games } = await loadTracks(db, session.id);
  const current = games[games.length - 1];
  if (current && !current.complete) return;

  const court = beginnerCourtOf(session);
  const unfinished = main.flatMap((r) => r.matches).filter((m) => m.status !== "confirmed");
  if (unfinished.some((m) => m.court === court)) return;
  const onMainCourt = new Set(unfinished.flatMap((m) => [...m.a, ...m.b]));
  const ready = newbies.filter((id) => !onMainCourt.has(id));
  if (ready.length < 4) return;

  const genders: Record<string, "woman" | "man"> = {};
  for (const p of players) if (p.gender === "woman" || p.gender === "man") genders[p.id] = p.gender;
  const number = (current?.number ?? 0) + 1;
  const plan = planBeginnerGame(
    {
      players: ready,
      courts: 1,
      roundNumber: number,
      // Someone who arrived (or was tagged) late is credited for the games they missed, so they join the rotation.
      ...creditAbsences(buildHistory(games), games, ready),
      standings: [],
      groupByLevel: false,
      genders,
      mixedPairs: session.mixedPairs,
      rng: Math.random,
    },
    court,
  );
  if (plan.matches.length === 0) return;

  const roundId = newId();
  try {
    await db.insert(rounds).values({
      id: roundId,
      sessionId: session.id,
      number: BEGINNER_TRACK_BASE + number,
      byesJson: JSON.stringify(plan.byes),
      track: "beginner",
      createdAt: now(),
    });
  } catch {
    return; // two scores landing together both deal the same game number: one wins
  }
  await db.insert(matches).values(
    plan.matches.map((m) => ({
      id: newId(),
      sessionId: session.id,
      roundId,
      court: m.court,
      a1: m.a[0],
      a2: m.a[1],
      b1: m.b[0],
      b2: m.b[1],
      status: "pending" as const,
    })),
  );
}

/**
 * Drop the beginner court's current game if nothing has been scored on it —
 * for a reshuffle, or when the court's settings change under it. Returns
 * whether there's now room for a fresh one.
 */
export async function dropUnscoredBeginnerGame(db: DB, sessionId: string): Promise<boolean> {
  const { beginner: games } = await loadTracks(db, sessionId);
  const current = games[games.length - 1];
  if (!current || current.complete) return true;
  if (current.matches.some((m) => m.scoreA != null)) return false;
  await db.delete(rounds).where(eq(rounds.id, current.id));
  return true;
}

async function recourtUpNext(db: DB, playing: RoundRow, upNext: RoundRow, courts: number, reserved = 0): Promise<void> {
  if (upNext.matches.some((m) => m.scoreA != null)) return;
  const planned = courtsWhenDealtAhead(
    upNext.matches.map((m) => ({ a: m.a, b: m.b, court: m.court })),
    playing.matches,
    courts,
    reserved,
  );
  for (const m of upNext.matches) {
    const court = planned.find((x) => x.a[0] === m.a[0])?.court;
    if (court != null && court !== m.court) await db.update(matches).set({ court }).where(eq(matches.id, m.id));
  }
}

/** Finishing the night: rounds dealt at the end that nobody played (no scores) are dropped. */
export async function dropUnplayedUpNext(db: DB, sessionId: string): Promise<void> {
  // The beginner court's game in waiting goes too.
  await dropUnscoredBeginnerGame(db, sessionId);
  const played = await loadRounds(db, sessionId);
  while (played.length > 1 && played[played.length - 1].matches.every((m) => m.scoreA == null)) {
    await db.delete(rounds).where(eq(rounds.id, played.pop()!.id));
  }
}

/** `reserved` is the beginner court's number (0 = none): its game keeps that court and waits for it if need be. */
export function courtsWhenDealtAhead(planned: PlannedMatch[], current: MatchRow[], courts: number, reserved = 0): PlannedMatch[] {
  const kept = planned.filter((m) => m.court === reserved);
  const pool = Array.from({ length: courts }, (_, i) => i + 1).filter((c) => c !== reserved);
  const finishingOn = new Map<string, number>();
  for (const m of current) if (m.status !== "confirmed") for (const p of [...m.a, ...m.b]) finishingOn.set(p, m.court);
  const busyCourts = new Set(finishingOn.values());
  const free = pool.filter((c) => !busyCourts.has(c));
  const taken = new Set<number>();
  const out = planned.filter((m) => m.court !== reserved).map((m) => ({ ...m, court: 0 }));
  // Waiting courts first, onto the court their players are finishing on.
  for (const m of out) {
    const on = [...m.a, ...m.b].map((p) => finishingOn.get(p)).find((c) => c != null && c !== reserved && !taken.has(c));
    if (on != null) taken.add((m.court = on));
  }
  // Ready courts onto free courts; anything left takes whatever number is left.
  for (const m of out) {
    if (m.court) continue;
    const c = [...free, ...pool].find((n) => !taken.has(n))!;
    taken.add((m.court = c));
  }
  return [...kept, ...out].sort((a, b) => a.court - b.court);
}

/**
 * Keep teams together: the session's pairs, plus checked-in players without a
 * partner paired up now (and saved, so the teams stay fixed from here on).
 */
async function fixTeams(
  db: DB,
  players: (typeof sessionPlayers.$inferSelect)[],
  eligible: string[],
  ctx: Pick<EngineContext, "levels" | "groupByLevel" | "genders" | "mixedPairs" | "rng">,
): Promise<[string, string][]> {
  const byId = new Map(players.map((p) => [p.id, p]));
  const paired = (id: string) => {
    const p = byId.get(id);
    const partner = p?.partnerId ? byId.get(p.partnerId) : undefined;
    return !!p && p.status !== "dropped" && !!partner && partner.partnerId === p.id && partner.status !== "dropped";
  };
  const teams: [string, string][] = players.filter((p) => paired(p.id) && p.id < p.partnerId!).map((p) => [p.id, p.partnerId!]);
  const fresh = autoPair(eligible.filter((id) => !paired(id)), ctx);
  if (fresh.length > 0) {
    const updates = fresh.flatMap(([a, b]) => [
      db.update(sessionPlayers).set({ partnerId: b }).where(eq(sessionPlayers.id, a)),
      db.update(sessionPlayers).set({ partnerId: a }).where(eq(sessionPlayers.id, b)),
    ]);
    await db.batch(updates as [(typeof updates)[number], ...(typeof updates)[number][]]);
  }
  return [...teams, ...fresh];
}

export type MatchDbRow = typeof matches.$inferSelect;

/** Rewrite the denormalised per-player result rows for a confirmed match. */
export async function writeMatchResults(db: DB, match: MatchDbRow): Promise<void> {
  await db.delete(playerResults).where(eq(playerResults.matchId, match.id));
  if (match.scoreA == null || match.scoreB == null) return;
  const ts = now();
  const rows = [];
  const teams: { ids: [string, string]; scoreFor: number; scoreAgainst: number }[] = [
    { ids: [match.a1, match.a2], scoreFor: match.scoreA, scoreAgainst: match.scoreB },
    { ids: [match.b1, match.b2], scoreFor: match.scoreB, scoreAgainst: match.scoreA },
  ];
  for (const team of teams) {
    const result = team.scoreFor > team.scoreAgainst ? "win" : team.scoreFor < team.scoreAgainst ? "loss" : "tie";
    for (let i = 0; i < 2; i++) {
      rows.push({
        id: newId(),
        sessionId: match.sessionId,
        roundId: match.roundId,
        matchId: match.id,
        playerId: team.ids[i],
        partnerId: team.ids[1 - i],
        pointsFor: team.scoreFor,
        pointsAgainst: team.scoreAgainst,
        result,
        createdAt: ts,
      });
    }
  }
  await db.insert(playerResults).values(rows);
}

export async function clearMatchResults(db: DB, matchId: string): Promise<void> {
  await db.delete(playerResults).where(eq(playerResults.matchId, matchId));
}
