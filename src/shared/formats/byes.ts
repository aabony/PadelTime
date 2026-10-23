import type { EngineContext } from "./types";
import { shuffle } from "./types";

/**
 * Who sits out this round: fewest sit-outs so far first, then (dealing ahead)
 * whoever is still finishing a game, then whoever sat longest ago, then random —
 * so sit-outs rotate evenly.
 */
export function pickByes(ctx: EngineContext, byeCount: number): string[] {
  if (byeCount <= 0) return [];
  // Random shuffle first so equal candidates rotate fairly, then a stable sort
  // by fairness criteria.
  const candidates = shuffle([...ctx.players], ctx.rng);
  candidates.sort((x, y) => {
    const [fx, fy] = [byeFairness(ctx, x), byeFairness(ctx, y)];
    return fx[0] - fy[0] || fx[1] - fy[1] || fx[2] - fy[2];
  });
  return candidates.slice(0, byeCount);
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
