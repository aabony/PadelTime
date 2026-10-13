import type { EngineContext } from "./types";
import { shuffle } from "./types";

/**
 * Who sits out this round: fewest sit-outs so far first, then whoever sat
 * longest ago, then random — so sit-outs rotate evenly.
 */
export function pickByes(ctx: EngineContext, byeCount: number): string[] {
  if (byeCount <= 0) return [];
  // Random shuffle first so equal candidates rotate fairly, then a stable sort
  // by fairness criteria: fewest byes sit next, then whoever sat longest ago.
  const candidates = shuffle([...ctx.players], ctx.rng);
  candidates.sort(
    (x, y) =>
      (ctx.byeCounts[x] ?? 0) - (ctx.byeCounts[y] ?? 0) ||
      (ctx.lastByeRound[x] ?? 0) - (ctx.lastByeRound[y] ?? 0),
  );
  return candidates.slice(0, byeCount);
}
