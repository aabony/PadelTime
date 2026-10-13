import type { EngineContext } from "./types";
import { shuffle } from "./types";
import { ADVANCED, UNSET_LEVEL, isBeginner } from "../levels";
import { pickByes } from "./byes";

// "Group players by playing level" — shared by both formats.
// Beginners play beginners; intermediate and advanced play each other. Levels
// are organizer-set (never shown to players); an unset player counts as
// intermediate. Sit-out fairness is never traded away: only players exactly
// tied on fairness can be swapped to make cleaner courts.

/** The level map to group by, or null when grouping is off or no player on the night has a level. */
export function groupingLevels(ctx: EngineContext): Record<string, number> | null {
  if (!ctx.groupByLevel || !ctx.levels) return null;
  return ctx.players.some((p) => ctx.levels![p] != null) ? ctx.levels : null;
}

export function levelIn(levels: Record<string, number>, id: string): number {
  return levels[id] ?? UNSET_LEVEL;
}

/**
 * How badly a court of four mixes levels. A beginner sharing a court with
 * stronger players is the thing to avoid (10, +10 more if an advanced player is
 * there too); intermediate with advanced is mild (1); one level is free.
 */
export function levelMixCost(four: string[], levels: Record<string, number>): number {
  const ls = four.map((id) => levelIn(levels, id));
  const beg = ls.some((l) => isBeginner(l));
  const adv = ls.some((l) => l >= ADVANCED);
  const mid = ls.some((l) => !isBeginner(l) && l < ADVANCED);
  if (beg && (adv || mid)) return 10 + (adv ? 10 : 0);
  return adv && mid ? 1 : 0;
}

/** Players split into advanced, intermediate (incl. unset) and beginner tiers, each shuffled. */
export function levelTiers(players: string[], levels: Record<string, number>, rng: () => number): string[][] {
  const adv = players.filter((p) => levelIn(levels, p) >= ADVANCED);
  const beg = players.filter((p) => isBeginner(levelIn(levels, p)));
  const mid = players.filter((p) => !adv.includes(p) && !beg.includes(p));
  return [shuffle(adv, rng), shuffle(mid, rng), shuffle(beg, rng)];
}

/**
 * Sit-outs as pickByes chooses them (fewest sit-outs first, then longest since
 * the last one), except that players tied exactly at the cut-off may be swapped
 * for each other when that gives a cheaper set of courts. `evaluate` scores a
 * candidate sit-out set (lower is better) and may carry a by-product (e.g. the
 * court order it computed) back to the caller.
 *
 * Between equally good sets, beginners still waiting for their first game get
 * it first: they're the group that needs whole courts to itself, and leaving
 * two or three of them for later strands them with nobody their level to play.
 */
export function chooseSitOuts<T>(
  ctx: EngineContext,
  count: number,
  levels: Record<string, number>,
  evaluate: (sitters: string[]) => { cost: number; result: T },
): { sitters: string[]; result: T } {
  const waitingBeginner = (p: string) => isBeginner(levelIn(levels, p)) && !ctx.playedCounts[p];
  // Tie-break worth far less than any real mix (the smallest is 0.5).
  const score = (sitters: string[]) => {
    const r = evaluate(sitters);
    return { ...r, cost: r.cost + 0.001 * sitters.filter(waitingBeginner).length };
  };
  const base = pickByes(ctx, count);
  let best = { sitters: base, ...score(base) };
  if (count <= 0 || best.cost === 0) return { sitters: best.sitters, result: best.result };

  const fair = (id: string): [number, number] => [ctx.byeCounts[id] ?? 0, ctx.lastByeRound[id] ?? 0];
  const cmp = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
  const cut = base.map(fair).reduce((m, f) => (cmp(f, m) > 0 ? f : m));
  const mustSit = ctx.players.filter((p) => cmp(fair(p), cut) < 0);
  const tied = ctx.players.filter((p) => cmp(fair(p), cut) === 0);
  const need = count - mustSit.length;
  if (need <= 0 || need >= tied.length) return { sitters: best.sitters, result: best.result };

  const consider = (sit: string[]) => {
    const sitters = [...mustSit, ...sit];
    const r = score(sitters);
    if (r.cost < best.cost) best = { sitters, ...r };
  };
  // Level-sorted blocks first: the players who play are a contiguous run of levels.
  const byLevel = [...tied].sort((a, b) => levelIn(levels, b) - levelIn(levels, a));
  const play = tied.length - need;
  for (let start = 0; start + play <= byLevel.length && best.cost > 0; start++) {
    const playing = new Set(byLevel.slice(start, start + play));
    consider(byLevel.filter((p) => !playing.has(p)));
  }
  for (let i = 0; i < 300 && best.cost > 0; i++) consider(shuffle([...tied], ctx.rng).slice(0, need));
  return { sitters: best.sitters, result: best.result };
}
