// Verbatim copy of src/shared/formats/americano.ts before "Group players by playing level" (commit 5459100).
// Regression guard: with the toggle off, the live planner must produce identical plans.
import type { EngineContext, FormatStrategy, PlannedMatch, RoundPlan } from "../../src/shared/formats/types";
import { pairKey, shuffle } from "../../src/shared/formats/types";
const UNSET_LEVEL = 2.5;

// Americano:
//  - rotating partners, fixed total points per match, individual cumulative scoring
//  - pairing goal: maximum partner diversity first, opponent diversity second
//  - byes rotate evenly: fewest byes sit next; ties broken by longest time
//    since the last bye, then randomly
//
// Pairing works by scored search (plan §11): many random orderings are chunked
// into courts of four; each court of four tries all three internal team splits
// and keeps the cheapest. Repeat partners cost quadratically more than repeat
// opponents, so the engine burns opponent variety before it ever repeats a
// partnership. Player counts at a padel night are small (≤ ~28), so a few
// thousand restarts explore the space thoroughly in a few milliseconds.

const PARTNER_WEIGHT = 40;
const OPPONENT_WEIGHT = 3;
// Level imbalance between the two teams (sum of levels). Deliberately below one
// opponent repeat, so it only decides between otherwise-equal splits: strong +
// weak vs strong + weak rather than the two strongest together.
const BALANCE_WEIGHT = 1;
const SHARED_WEIGHT = 2;
// A same-gender team when "mixed pairs" is on. Two of them on a court (60)
// outweigh one repeat partnership (40), a double repeat (80) does not.
const MIXED_WEIGHT = 30;

function sameGenderTeam(t: [string, string], ctx: EngineContext): boolean {
  const g0 = ctx.genders?.[t[0]];
  const g1 = ctx.genders?.[t[1]];
  return !!g0 && g0 === g1;
}

/**
 * Court order for a restart. With mixed pairs on, courts are built as two women
 * + two men for as long as both pools last; the leftovers fill the rest.
 */
export function drawOrder(active: string[], courtCount: number, ctx: EngineContext): string[] {
  if (!ctx.mixedPairs || !ctx.genders) return shuffle([...active], ctx.rng);
  const women = shuffle(active.filter((p) => ctx.genders![p] === "woman"), ctx.rng);
  const men = shuffle(active.filter((p) => ctx.genders![p] === "man"), ctx.rng);
  const rest = active.filter((p) => !ctx.genders![p]);
  const mixedCourts = Math.min(courtCount, Math.floor(women.length / 2), Math.floor(men.length / 2));
  const order: string[] = [];
  for (let c = 0; c < mixedCourts; c++) order.push(women.pop()!, women.pop()!, men.pop()!, men.pop()!);
  return order.concat(shuffle([...women, ...men, ...rest], ctx.rng));
}

function levelOf(id: string, ctx: EngineContext): number {
  return ctx.levels?.[id] ?? UNSET_LEVEL;
}

function teamsCost(a: [string, string], b: [string, string], ctx: EngineContext): number {
  const pa = ctx.partnerCounts[pairKey(a[0], a[1])] ?? 0;
  const pb = ctx.partnerCounts[pairKey(b[0], b[1])] ?? 0;
  let cost = PARTNER_WEIGHT * (pa * pa + pb * pb);
  for (const x of a) {
    for (const y of b) {
      const o = ctx.opponentCounts[pairKey(x, y)] ?? 0;
      cost += OPPONENT_WEIGHT * o * o;
    }
  }
  if (ctx.levels) {
    const gap = Math.abs(levelOf(a[0], ctx) + levelOf(a[1], ctx) - levelOf(b[0], ctx) - levelOf(b[1], ctx));
    cost += BALANCE_WEIGHT * gap;
  }
  if (ctx.mixedPairs && ctx.genders) {
    if (sameGenderTeam(a, ctx)) cost += MIXED_WEIGHT;
    if (sameGenderTeam(b, ctx)) cost += MIXED_WEIGHT;
  }
  // Sharing a court at all (as partner or opponent) is what players notice —
  // "I keep ending up with the same people" — so spread that too.
  if (SHARED_WEIGHT > 0) {
    const four = [a[0], a[1], b[0], b[1]];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const k = pairKey(four[i], four[j]);
        const shared = (ctx.partnerCounts[k] ?? 0) + (ctx.opponentCounts[k] ?? 0);
        cost += SHARED_WEIGHT * shared * shared;
      }
    }
  }
  return cost;
}

function bestSplit(four: string[], ctx: EngineContext): { a: [string, string]; b: [string, string]; cost: number } {
  const [p0, p1, p2, p3] = four;
  const options: [[string, string], [string, string]][] = [
    [[p0, p1], [p2, p3]],
    [[p0, p2], [p1, p3]],
    [[p0, p3], [p1, p2]],
  ];
  let best = options[0];
  let bestCost = Infinity;
  for (const [a, b] of options) {
    const cost = teamsCost(a, b, ctx);
    if (cost < bestCost) {
      bestCost = cost;
      best = [a, b];
    }
  }
  return { a: best[0], b: best[1], cost: bestCost };
}

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

export const americano: FormatStrategy = {
  key: "americano",
  name: "Americano",
  minPlayers: 4,
  defaultPoints: 24,

  planRound(ctx: EngineContext): RoundPlan {
    const courtCount = Math.min(ctx.courts, Math.floor(ctx.players.length / 4));
    if (courtCount === 0) {
      return { matches: [], byes: [...ctx.players] };
    }
    const byes = pickByes(ctx, ctx.players.length - courtCount * 4);
    const byeSet = new Set(byes);
    const active = ctx.players.filter((p) => !byeSet.has(p));

    let best: PlannedMatch[] | null = null;
    let bestCost = Infinity;
    const restarts = Math.min(4000, 500 + active.length * 150);
    for (let i = 0; i < restarts; i++) {
      const order = drawOrder(active, courtCount, ctx);
      let cost = 0;
      const matches: PlannedMatch[] = [];
      for (let c = 0; c < courtCount; c++) {
        const four = order.slice(c * 4, c * 4 + 4);
        const split = bestSplit(four, ctx);
        matches.push({ court: c + 1, a: split.a, b: split.b });
        cost += split.cost;
        if (cost >= bestCost) break; // prune hopeless orderings early
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = matches;
        if (cost === 0) break;
      }
    }
    return { matches: best ?? [], byes };
  },
};
