import type { EngineContext, FormatStrategy, PlannedMatch, RoundPlan } from "./types";
import { pairKey, shuffle } from "./types";
import { americano } from "./americano";
import { pickByes } from "./byes";
import { chooseSitOuts, groupingLevels, levelIn, levelMixCost } from "./levelGrouping";
import { ADVANCED, isBeginner } from "../levels";

type Split = [[string, string], [string, string]];

/** Candidate team splits for a court, most balanced first. */
function splitsFor(four: string[], ctx: EngineContext): Split[] {
  const [p1, p2, p3, p4] = four;
  if (ctx.mixedPairs && ctx.genders) {
    const women = four.filter((p) => ctx.genders![p] === "woman");
    const men = four.filter((p) => ctx.genders![p] === "man");
    if (women.length === 2 && men.length === 2) {
      // Both mixed splits (`four` is rank-ordered within each gender): best woman +
      // second man vs second woman + best man first, then the straight pairing.
      return [
        [[women[0], men[1]], [women[1], men[0]]],
        [[women[0], men[0]], [women[1], men[1]]],
      ];
    }
  }
  return [
    [[p1, p4], [p2, p3]],
    [[p1, p3], [p2, p4]],
    [[p1, p2], [p3, p4]],
  ];
}

/** Courts of four in rank order; with mixed pairs, two women + two men per court while both last. */
function courtGroups(ranked: string[], courtCount: number, ctx: EngineContext): string[][] {
  if (ctx.mixedPairs && ctx.genders) {
    const women = ranked.filter((p) => ctx.genders![p] === "woman");
    const men = ranked.filter((p) => ctx.genders![p] === "man");
    const rest = ranked.filter((p) => !ctx.genders![p]);
    const groups: string[][] = [];
    while (groups.length < courtCount && women.length >= 2 && men.length >= 2) {
      groups.push([women.shift()!, women.shift()!, men.shift()!, men.shift()!]);
    }
    // Leftovers in overall rank order fill the remaining courts.
    const rank = new Map(ranked.map((p, i) => [p, i]));
    const leftovers = [...women, ...men, ...rest].sort((x, y) => rank.get(x)! - rank.get(y)!);
    while (groups.length < courtCount) groups.push(leftovers.splice(0, 4));
    return groups;
  }
  return Array.from({ length: courtCount }, (_, c) => ranked.slice(c * 4, c * 4 + 4));
}

// Mexicano — the competitive sibling of Americano.
//  - Round 1 is a random draw (no standings yet), planned exactly like Americano
//    (unless grouping by level, below).
//  - From then on players are ranked by total points and dealt in blocks of
//    four: the top four to court 1, the next four to court 2, and so on.
//    Within a court the balanced split is 1st & 4th vs 2nd & 3rd, so matches
//    stay close; the engine only deviates from it to avoid a repeat partnership.
//  - Byes rotate fairly (fewest sit-outs first), same as Americano — the
//    players at the bottom shouldn't also be the ones sitting out.
//  - Players with no results yet (late arrivals) start on the bottom court.
//  - "Group players by playing level" (session toggle, organizer-set levels):
//    a player's first TWO games are placed by level instead of results — one
//    short game (often against their own level) says too little. By level alone
//    while nobody has two results, otherwise next to the settled players on
//    court at their own level (or, if there are none, slotted into the ladder:
//    advanced a quarter of the way down, intermediate/unset halfway, beginners
//    three quarters); among themselves, by their result so far.
//    The FIRST game is also kept on one side of the beginner line: players tied
//    on sit-out fairness are chosen so first games don't mix beginners with
//    stronger players, and when the ladder still can't manage that the round
//    bends — the courts are split at the beginner line (ladder order on each
//    side), or failing that players are swapped between courts. After two
//    games, results alone deal the courts.
//    With so many sitting (18 on 2 courts), rounds 1 and 2 are both all first
//    games, which is why this works per player rather than on round 1 only.

/** Grouping by level: games before a player's results (rather than their level) place them. */
const SETTLED_AFTER = 2;

/** Where a player without results slots into the ladder, as a fraction of the way down. */
function ladderSlot(level: number): number {
  if (level >= ADVANCED) return 0.25;
  return isBeginner(level) ? 0.75 : 0.5;
}

/**
 * Court order for the players on court. Ranked players keep their standings
 * order. Players without results go to the bottom — unless grouping by level,
 * where players with fewer than two results are placed by level (see above).
 * Ties are broken at random.
 */
function orderOnCourt(ctx: EngineContext, onCourt: string[], levels: Record<string, number> | null): string[] {
  // Without grouping every result counts; with it, only players with two or more (a missing count counts as settled).
  const settled = ctx.standings.filter((s) => !levels || (s.played ?? SETTLED_AFTER) >= SETTLED_AFTER);
  const rank = new Map(settled.map((s, i) => [s.playerId, i]));
  const ranked = settled.length;
  const perGame = new Map(ctx.standings.map((s) => [s.playerId, s.played ? s.points / s.played : 0]));
  // A newcomer sits next to the players on court at their own level (exact level,
  // else same side of the beginner line), so their first game is with them.
  const meanRank = (match: (level: number) => boolean): number | null => {
    const idx = onCourt.filter((p) => rank.has(p) && match(levelIn(levels!, p))).map((p) => rank.get(p)!);
    return idx.length ? idx.reduce((a, b) => a + b, 0) / idx.length : null;
  };
  const key = (id: string): number => {
    const r = rank.get(id);
    if (r != null) return r;
    if (!levels) return ranked;
    const level = levelIn(levels, id);
    if (ranked === 0) return -level;
    return (
      meanRank((l) => l === level) ??
      meanRank((l) => isBeginner(l) === isBeginner(level)) ??
      ladderSlot(level) * ranked
    );
  };
  const tier = (id: string) => (rank.has(id) ? 0 : 1);
  const result = (id: string) => (rank.has(id) ? 0 : (perGame.get(id) ?? -1));
  // Shuffle first so exact ties land in random order; the sort is stable.
  return shuffle([...onCourt], ctx.rng).sort((x, y) => key(x) - key(y) || tier(x) - tier(y) || result(y) - result(x));
}

/**
 * The courts dealt on each side of the beginner line separately: beginners'
 * courts and everyone else's, each side in ladder order, the stronger side
 * first. Null when the beginners on court don't fill whole courts.
 */
function splitAtBeginnerLine(order: string[], levels: Record<string, number>, ctx: EngineContext): string[][] | null {
  const beg = order.filter((p) => isBeginner(levelIn(levels, p)));
  const rest = order.filter((p) => !isBeginner(levelIn(levels, p)));
  if (beg.length === 0 || rest.length === 0 || beg.length % 4 !== 0) return null;
  const pos = new Map(order.map((p, i) => [p, i]));
  const meanPos = (group: string[]) => group.reduce((s, p) => s + pos.get(p)!, 0) / group.length;
  const sides = meanPos(beg) < meanPos(rest) ? [beg, rest] : [rest, beg];
  return sides.flatMap((side) => courtGroups(side, side.length / 4, ctx));
}

/**
 * The cheapest first-game mix any split of these players into courts could
 * reach. Players reduce to (first game?) x (advanced / intermediate / beginner)
 * counts, so a small memoised search over courts of four is exact.
 */
function mixLowerBound(players: string[], hasResults: Set<string>, levels: Record<string, number>): number {
  const category = (p: string) => {
    const l = levelIn(levels, p);
    return (hasResults.has(p) ? 3 : 0) + (isBeginner(l) ? 2 : l >= ADVANCED ? 0 : 1);
  };
  const counts = [0, 0, 0, 0, 0, 0];
  for (const p of players) counts[category(p)]++;
  const courtCost = (c: number[]) => {
    const firstGame = c[0] + c[1] + c[2] > 0;
    const beginner = c[2] + c[5] > 0;
    const stronger = c[0] + c[1] + c[3] + c[4] > 0;
    return firstGame && beginner && stronger ? 10 + (c[0] + c[3] > 0 ? 10 : 0) : 0;
  };
  const memo = new Map<string, number>();
  const solve = (left: number[]): number => {
    if (left.every((x) => x === 0)) return 0;
    const key = left.join();
    const hit = memo.get(key);
    if (hit != null) return hit;
    // The next court always takes someone from the first non-empty category, so each split is counted once.
    const first = left.findIndex((x) => x > 0);
    const court = [0, 0, 0, 0, 0, 0];
    let best = Infinity;
    const fill = (i: number, seats: number) => {
      if (i === 6) {
        if (seats === 0 && court[first] > 0) best = Math.min(best, courtCost(court) + solve(left.map((x, k) => x - court[k])));
        return;
      }
      for (let x = 0; x <= Math.min(seats, left[i]); x++) {
        court[i] = x;
        fill(i + 1, seats - x);
      }
      court[i] = 0;
    };
    fill(0, 4);
    memo.set(key, best);
    return best;
  };
  return solve(counts);
}

/**
 * Swap players between courts while that lowers `cost` (with mixed pairs, only
 * a woman for a woman or a man for a man), stopping at `bound`. With `deep`,
 * when no single swap helps, two swaps are tried together — a court's cost only
 * drops once it's fully cleared, so single swaps can stall. Courts are then put
 * back in ladder order, and so are the players within each court.
 */
function untangle(
  groups: string[][],
  order: string[],
  cost: (g: string[][]) => number,
  ctx: EngineContext,
  bound: number,
  deep = false,
): string[][] {
  type Move = [number, number, number, number];
  const g = groups.map((four) => [...four]);
  const moves: Move[] = [];
  for (let a = 0; a < g.length; a++) {
    for (let b = a + 1; b < g.length; b++) {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) moves.push([a, i, b, j]);
    }
  }
  const swap = ([a, i, b, j]: Move) => {
    [g[a][i], g[b][j]] = [g[b][j], g[a][i]];
  };
  const allowed = ([a, i, b, j]: Move) =>
    !ctx.mixedPairs || !ctx.genders || ctx.genders[g[a][i]] === ctx.genders[g[b][j]];
  let current = cost(g);
  while (current > bound) {
    let improved = false;
    for (const m of moves) {
      if (!allowed(m)) continue;
      swap(m);
      const c = cost(g);
      if (c < current) {
        current = c;
        improved = true;
      } else {
        swap(m);
      }
    }
    if (improved) continue;
    if (!deep) break;
    pairs: for (let x = 0; x < moves.length; x++) {
      if (!allowed(moves[x])) continue;
      swap(moves[x]);
      for (let y = x + 1; y < moves.length; y++) {
        if (!allowed(moves[y])) continue;
        swap(moves[y]);
        const c = cost(g);
        if (c < current) {
          current = c;
          improved = true;
          break pairs;
        }
        swap(moves[y]);
      }
      swap(moves[x]);
    }
    if (!improved) break;
  }
  const pos = new Map(order.map((p, i) => [p, i]));
  const meanPos = (four: string[]) => four.reduce((s, p) => s + pos.get(p)!, 0);
  return g.map((four) => four.sort((x, y) => pos.get(x)! - pos.get(y)!)).sort((x, y) => meanPos(x) - meanPos(y));
}

function repeatPartners(a: [string, string], b: [string, string], ctx: EngineContext): number {
  return (ctx.partnerCounts[pairKey(a[0], a[1])] ?? 0) + (ctx.partnerCounts[pairKey(b[0], b[1])] ?? 0);
}

export const mexicano: FormatStrategy = {
  key: "mexicano",
  name: "Mexicano",
  minPlayers: 4,
  defaultPoints: 24,

  planRound(ctx: EngineContext): RoundPlan {
    const levels = groupingLevels(ctx);
    // Nothing on the board and nothing to group by → a random draw.
    if (ctx.standings.length === 0 && !levels) return americano.planRound(ctx);

    const courtCount = Math.min(ctx.courts, Math.floor(ctx.players.length / 4));
    if (courtCount === 0) {
      return { matches: [], byes: [...ctx.players] };
    }
    const sitCount = ctx.players.length - courtCount * 4;
    const onCourtFor = (sitters: string[]) => {
      const sitting = new Set(sitters);
      return ctx.players.filter((p) => !sitting.has(p));
    };

    let byes: string[];
    let groups: string[][];
    if (levels) {
      // Only first games count: courts where everyone already has results are the ladder's business.
      const hasResults = new Set(ctx.standings.map((s) => s.playerId));
      const firstGameMix = (courts: string[][]) => {
        let cost = 0;
        for (const four of courts) if (four.some((p) => !hasResults.has(p))) cost += levelMixCost(four, levels);
        return cost;
      };
      const pick = chooseSitOuts(ctx, sitCount, levels, (sitters) => {
        const ladder = orderOnCourt(ctx, onCourtFor(sitters), levels);
        const dealt = courtGroups(ladder, courtCount, ctx);
        let best = { cost: firstGameMix(dealt), result: dealt };
        if (best.cost === 0) return best;
        // The ladder can't keep every first game on one side of the beginner line,
        // so bend it for this round (a small penalty keeps the ladder preferred):
        // split the courts at the line, or failing that swap players between courts.
        const split = splitAtBeginnerLine(ladder, levels, ctx);
        const splitCost = split ? firstGameMix(split) + 0.5 : Infinity;
        if (splitCost < best.cost) best = { cost: splitCost, result: split! };
        if (best.cost > 0.5) {
          const swapped = untangle(dealt, ladder, firstGameMix, ctx, 0);
          const swappedCost = firstGameMix(swapped) + 0.5;
          if (swappedCost < best.cost) best = { cost: swappedCost, result: swapped };
        }
        return best;
      });
      byes = pick.sitters;
      groups = pick.result;
      // Once, on the chosen sit-outs: escape single-swap plateaus when the count bound says it's worth it.
      const onCourt = groups.flat();
      const bound = mixLowerBound(onCourt, hasResults, levels);
      const now = firstGameMix(groups);
      if (now > bound) {
        const ladder = orderOnCourt(ctx, onCourt, levels);
        const deeper = untangle(groups, ladder, firstGameMix, ctx, bound, true);
        if (firstGameMix(deeper) < now) groups = deeper;
      }
    } else {
      byes = pickByes(ctx, sitCount);
      groups = courtGroups(orderOnCourt(ctx, onCourtFor(byes), null), courtCount, ctx);
    }

    const matches: PlannedMatch[] = [];
    for (let c = 0; c < courtCount; c++) {
      // Most balanced split first; only a fresher partnership can displace it.
      const splits = splitsFor(groups[c], ctx);
      let pick = splits[0];
      let pickRepeats = repeatPartners(pick[0], pick[1], ctx);
      for (const s of splits.slice(1)) {
        const r = repeatPartners(s[0], s[1], ctx);
        if (r < pickRepeats) {
          pick = s;
          pickRepeats = r;
        }
      }
      matches.push({ court: c + 1, a: pick[0], b: pick[1] });
    }
    return { matches, byes };
  },
};
