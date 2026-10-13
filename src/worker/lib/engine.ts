import { eq } from "drizzle-orm";
import { getFormat } from "../../shared/formats/registry";
import type { EngineContext } from "../../shared/formats/types";
import { buildHistory } from "../../shared/history";
import { computeStandings, rankForCourts } from "../../shared/standings";
import { normalizeLevel } from "../../shared/levels";
import { matches, playerResults, rounds, sessionPlayers } from "../db/schema";
import type { DB, SessionRow } from "./detail";
import { loadRounds } from "./detail";
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

  const players = await db
    .select()
    .from(sessionPlayers)
    .where(eq(sessionPlayers.sessionId, session.id));
  const eligible = players.filter((p) => p.status === "checked_in").map((p) => p.id);
  const levels: Record<string, number> = {};
  const genders: Record<string, "woman" | "man"> = {};
  for (const p of players) {
    // Levels only matter when the session groups by level; otherwise the engine never sees them.
    const level = session.groupByLevel ? normalizeLevel(p.level) : null;
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

  const history = buildHistory(played);
  // Ranked formats deal courts from points per match played (bye-adjusted).
  const ranked = rankForCourts(computeStandings(players.map((p) => ({ id: p.id, name: p.id })), played)).filter(
    (r) => r.played > 0,
  );

  const ctx: EngineContext = {
    players: eligible,
    courts: session.courts,
    roundNumber: (latest?.number ?? 0) + 1,
    ...history,
    standings: ranked.map((r) => ({ playerId: r.playerId, points: r.points, diff: r.diff, played: r.played })),
    levels: session.groupByLevel ? levels : undefined,
    groupByLevel: session.groupByLevel,
    genders,
    mixedPairs: session.mixedPairs,
    rng: Math.random,
  };

  const plan = format.planRound(ctx);
  if (plan.matches.length === 0) {
    return { error: "Not enough players to fill a court." };
  }

  const ts = now();
  const roundId = newId();
  await db.insert(rounds).values({
    id: roundId,
    sessionId: session.id,
    number: ctx.roundNumber,
    byesJson: JSON.stringify(plan.byes),
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
