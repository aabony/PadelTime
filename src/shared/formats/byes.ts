import type { EngineContext } from "./types";
import { shuffle } from "./types";

/** Competitive sit-outs only start once everyone in the pool has played this many games. */
export const COMPETITIVE_FLOOR = 3;

/**
 * Who sits out this round: fewest sit-outs so far first, then (dealing ahead)
 * whoever is still finishing a game, then whoever sat longest ago, then random —
 * so sit-outs rotate evenly.
 *
 * Competitive sit-outs (session toggle): once every player here has played the
 * floor, the bottom of the table sits instead — lowest points per game first,
 * fairness breaking ties — so the night's later rounds go to whoever is winning.
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
    const avg = new Map(ctx.standings.map((s) => [s.playerId, s.played ? s.points / s.played : -1]));
    const of = (id: string) => avg.get(id) ?? -1;
    candidates.sort((x, y) => of(x) - of(y) || fair(x, y));
  } else {
    candidates.sort(fair);
  }
  return candidates.slice(0, byeCount);
}

/** Competitive sit-outs are on and everyone here has reached the floor. */
export function competitiveBenching(ctx: EngineContext): boolean {
  return !!ctx.competitive && ctx.players.length > 0 && ctx.players.every((p) => (ctx.playedCounts[p] ?? 0) >= COMPETITIVE_FLOOR);
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
