import type { EngineContext } from "./types";
import { shuffle } from "./types";
import { averageResult } from "../drop";

/**
 * Who sits out this round: fewest sit-outs so far first, then (dealing ahead)
 * whoever is still finishing a game, then whoever sat longest ago, then random —
 * so sit-outs rotate evenly.
 *
 * Competitive sit-outs (session toggle), from the round after the organizer's
 * "drop after round N": the bottom of the table sits instead — lowest points
 * per game first, fairness breaking ties — so the night's later rounds go to
 * whoever is winning. Nobody is dropped before their first game: a late
 * arrival who has never been dealt one plays before anyone is ranked out, and
 * someone still in their first game (the round on deck is dealt while it's
 * being played) counts as average.
 *
 * Finals (the organizer's button, for the last part of the night): the same
 * benching, straight away — no floor to reach. With 3 courts the top 12 play
 * and everyone else is done; someone who hasn't a result yet sits first.
 */
export function pickByes(ctx: EngineContext, byeCount: number): string[] {
  if (byeCount <= 0) return [];
  // Random shuffle first so equal candidates rotate fairly, then a stable sort
  // by fairness criteria.
  const candidates = shuffle([...ctx.players], ctx.rng);
  const fair = (x: string, y: string) => {
    const [fx, fy] = [byeFairness(ctx, x), byeFairness(ctx, y)];
    return fx[0] - fy[0] || fx[1] - fy[1] || fx[2] - fy[2];
  };
  if (competitiveBenching(ctx)) {
    const rows = ctx.standings.map((s) => ({ playerId: s.playerId, points: s.points, played: s.played ?? 0 }));
    const avg = new Map(rows.filter((s) => s.played > 0).map((s) => [s.playerId, s.points / s.played]));
    // The drop (not finals): someone never dealt a game sorts last, so they play; someone still in
    // their first game counts as average, so they take their turn instead of sitting for a result nobody has yet.
    const owedAGame = (id: string) => !ctx.finals && !(ctx.playedCounts[id] > 0);
    const here = new Set(ctx.players);
    const unknown = ctx.finals ? -1 : averageResult(rows.filter((s) => here.has(s.playerId)));
    const of = (id: string) => (owedAGame(id) ? Number.MAX_SAFE_INTEGER : avg.get(id) ?? unknown);
    candidates.sort((x, y) => of(x) - of(y) || fair(x, y));
  } else {
    candidates.sort(fair);
  }
  return candidates.slice(0, byeCount);
}

/** The table decides who sits: finals are on, or the drop has started (competitive sit-outs, past the organizer's round). */
export function competitiveBenching(ctx: EngineContext): boolean {
  return (!!ctx.finals || !!ctx.competitive) && ctx.players.length > 0;
}

/** Sit-out order key: sit-outs so far, then still busy on court (0) before free (1), then last sit-out round. */
export function byeFairness(ctx: EngineContext, id: string): [number, number, number] {
  return [ctx.byeCounts[id] ?? 0, ctx.busy?.includes(id) ? 0 : 1, ctx.lastByeRound[id] ?? 0];
}

/** Courts in a plan that would have to wait for a player still finishing elsewhere. */
export function waitingCourts(ctx: EngineContext, fours: string[][]): number {
  if (!ctx.busy?.length) return 0;
  const busy = new Set(ctx.busy);
  return fours.filter((four) => four.some((p) => busy.has(p))).length;
}
