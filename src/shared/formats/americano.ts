import type { EngineContext, FormatStrategy, PlannedMatch, RoundPlan } from "./types";
import { pairKey, shuffle } from "./types";
import { ADVANCED, UNSET_LEVEL, isBeginner } from "../levels";
import { pickByes } from "./byes";
import { chooseSitOuts, groupingLevels, levelIn, levelMixCost, levelSides } from "./levelGrouping";

export { pickByes };

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
//
// "Group players by playing level" (session toggle): every round the courts
// are split at the beginner line — intermediate and advanced players fill the
// first courts together, beginners the rest — partners still rotate within
// each side and teams are balanced by level. Players tied on sit-out fairness
// are chosen so the beginners on court fill whole courts where possible; when
// they can't, the court that mixes gets intermediates rather than advanced.
// Court numbers are shuffled so the board doesn't give the levels away.

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
  return genderOrder(active, courtCount, ctx);
}

/**
 * Court order for a restart when grouping by level: the intermediate/advanced
 * side fills the first courts, beginners the rest. If one court has to straddle
 * the line, intermediates take its non-beginner seats. With mixed pairs, each
 * court is filled towards two women + two men from its own side.
 */
function groupedOrder(sides: [string[], string[]], levels: Record<string, number>, ctx: EngineContext): string[] {
  let upper = shuffle([...sides[0]], ctx.rng);
  const beg = shuffle([...sides[1]], ctx.rng);
  const straddle = beg.length > 0 ? upper.length % 4 : 0;
  let mids: string[] = [];
  if (straddle > 0) {
    const isMid = (p: string) => levelIn(levels, p) < ADVANCED && !isBeginner(levelIn(levels, p));
    const reserved = upper.filter(isMid).slice(0, straddle);
    const moved = new Set(reserved);
    // Advanced players can't fill all straddle seats when mids run short: top up from the rest.
    upper = upper.filter((p) => !moved.has(p));
    mids = [...reserved, ...upper.splice(upper.length - (straddle - reserved.length), straddle - reserved.length)];
  }
  if (!ctx.mixedPairs || !ctx.genders) return [...upper, ...mids, ...beg];
  const g = ctx.genders;
  // Seats: full upper courts from `upper`, the straddling court's upper seats from `mids` only.
  const pools = [upper, beg, mids];
  const seats = [...upper.map(() => 0), ...mids.map(() => 2), ...beg.map(() => 1)];
  const order: string[] = [];
  for (let c = 0; c < seats.length; c += 4) {
    let women = 0;
    let men = 0;
    for (const side of seats.slice(c, c + 4)) {
      const pool = pools[side];
      const want = women >= 2 ? "man" : men >= 2 ? "woman" : null;
      const i = want ? pool.findIndex((p) => g[p] === want) : 0;
      const p = pool.splice(Math.max(i, 0), 1)[0];
      if (g[p] === "woman") women++;
      else if (g[p] === "man") men++;
      order.push(p);
    }
  }
  return order;
}

function genderOrder(active: string[], courtCount: number, ctx: EngineContext): string[] {
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
  // Levels only count when the session groups by level.
  if (ctx.levels && ctx.groupByLevel) {
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

/**
 * Cheapest team split of a court. `mixedOnly` (grouping by level, where the
 * same foursome can meet often): a court of two women + two men always gets
 * mixed teams, even at the price of a repeat partnership.
 */
function bestSplit(
  four: string[],
  ctx: EngineContext,
  mixedOnly = false,
): { a: [string, string]; b: [string, string]; cost: number } {
  const [p0, p1, p2, p3] = four;
  let options: [[string, string], [string, string]][] = [
    [[p0, p1], [p2, p3]],
    [[p0, p2], [p1, p3]],
    [[p0, p3], [p1, p2]],
  ];
  if (mixedOnly && ctx.mixedPairs && ctx.genders) {
    const women = four.filter((p) => ctx.genders![p] === "woman").length;
    const men = four.filter((p) => ctx.genders![p] === "man").length;
    if (women === 2 && men === 2) options = options.filter(([a, b]) => !sameGenderTeam(a, ctx) && !sameGenderTeam(b, ctx));
  }
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
    const sitCount = ctx.players.length - courtCount * 4;
    const levels = groupingLevels(ctx);
    // Grouping by level: among players tied on sit-out fairness, sit the ones that
    // let beginners fill whole courts (scored on the side layout, which depends only on counts).
    const byes = levels
      ? chooseSitOuts(ctx, sitCount, levels, (sitters) => {
          const sitting = new Set(sitters);
          const layout = levelSides(ctx.players.filter((p) => !sitting.has(p)), levels).flat();
          let cost = 0;
          for (let c = 0; c < courtCount; c++) cost += levelMixCost(layout.slice(c * 4, c * 4 + 4), levels);
          return { cost, result: null };
        }).sitters
      : pickByes(ctx, sitCount);
    const byeSet = new Set(byes);
    const active = ctx.players.filter((p) => !byeSet.has(p));
    const sides = levels ? levelSides(active, levels) : null;

    let best: PlannedMatch[] | null = null;
    let bestCost = Infinity;
    const restarts = Math.min(4000, 500 + active.length * 150);
    for (let i = 0; i < restarts; i++) {
      const order = sides ? groupedOrder(sides, levels!, ctx) : drawOrder(active, courtCount, ctx);
      let cost = 0;
      const matches: PlannedMatch[] = [];
      for (let c = 0; c < courtCount; c++) {
        const four = order.slice(c * 4, c * 4 + 4);
        const split = bestSplit(four, ctx, !!sides);
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
    if (levels && best) {
      // Court 1 shouldn't always be the strong side: shuffle the court numbers.
      const numbers = shuffle(best.map((m) => m.court), ctx.rng);
      best = best.map((m, i) => ({ ...m, court: numbers[i] })).sort((x, y) => x.court - y.court);
    }
    return { matches: best ?? [], byes };
  },
};
