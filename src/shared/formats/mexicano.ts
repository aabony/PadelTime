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
//  - Round 1 is a random draw (no standings yet), planned exactly like Americano.
//  - From then on players are ranked by total points and dealt in blocks of
//    four: the top four to court 1, the next four to court 2, and so on.
//    Within a court the balanced split is 1st & 4th vs 2nd & 3rd, so matches
//    stay close; the engine only deviates from it to avoid a repeat partnership.
//  - Byes rotate fairly (fewest sit-outs first), same as Americano — the
//    players at the bottom shouldn't also be the ones sitting out.
//  - Players with no results yet (late arrivals) start on the bottom court.
//  - "Group players by playing level" (session toggle, organizer-set levels):
//    a player's FIRST game is placed by level instead — by level alone while
//    nobody has results, otherwise next to the players on court at their own
//    level (or, if there are none, slotted into the ladder: advanced a quarter
//    of the way down, intermediate/unset halfway, beginners three quarters) —
//    and players tied on sit-out fairness are chosen so first games don't mix
//    beginners with stronger players. When the ladder still can't manage that,
//    the round is split at the beginner line (ladder order on each side).
//    After that, results deal the courts.
//    With so many sitting (18 on 2 courts), rounds 1 and 2 are both all first
//    games, which is why this works per player rather than on round 1 only.

/** Where a player without results slots into the ladder, as a fraction of the way down. */
function ladderSlot(level: number): number {
  if (level >= ADVANCED) return 0.25;
  return isBeginner(level) ? 0.75 : 0.5;
}

/**
 * Court order for the players on court. Ranked players keep their standings
 * order. Players without results go to the bottom — unless grouping by level,
 * where they're placed by level (see above). Ties are broken at random.
 */
function orderOnCourt(ctx: EngineContext, onCourt: string[], levels: Record<string, number> | null): string[] {
  const rank = new Map(ctx.standings.map((s, i) => [s.playerId, i]));
  const ranked = ctx.standings.length;
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
  // Shuffle first so exact ties land in random order; the sort is stable.
  return shuffle([...onCourt], ctx.rng).sort((x, y) => key(x) - key(y) || tier(x) - tier(y));
}

/**
 * The same court order split at the beginner line: beginners' courts and
 * everyone else's, each keeping its order, the stronger group first. Null when
 * the split wouldn't fill whole courts.
 */
function splitAtBeginnerLine(order: string[], levels: Record<string, number>): string[] | null {
  const beg = order.filter((p) => isBeginner(levelIn(levels, p)));
  const rest = order.filter((p) => !isBeginner(levelIn(levels, p)));
  if (beg.length === 0 || rest.length === 0 || beg.length % 4 !== 0) return null;
  const pos = new Map(order.map((p, i) => [p, i]));
  const meanPos = (group: string[]) => group.reduce((s, p) => s + pos.get(p)!, 0) / group.length;
  return meanPos(beg) < meanPos(rest) ? [...beg, ...rest] : [...rest, ...beg];
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
    let ranked: string[];
    if (levels) {
      // Only first games count: courts where everyone already has results are the ladder's business.
      const hasResults = new Set(ctx.standings.map((s) => s.playerId));
      const firstGameMix = (order: string[]) => {
        let cost = 0;
        for (const four of courtGroups(order, courtCount, ctx)) {
          if (four.some((p) => !hasResults.has(p))) cost += levelMixCost(four, levels);
        }
        return cost;
      };
      const pick = chooseSitOuts(ctx, sitCount, levels, (sitters) => {
        const ladder = orderOnCourt(ctx, onCourtFor(sitters), levels);
        const cost = firstGameMix(ladder);
        // When the ladder can't keep a first game on one side of the beginner line,
        // bend it for this round: split at the line, ladder order within each side.
        const split = cost > 0 ? splitAtBeginnerLine(ladder, levels) : null;
        const splitCost = split ? firstGameMix(split) + 0.5 : Infinity;
        return splitCost < cost ? { cost: splitCost, result: split! } : { cost, result: ladder };
      });
      byes = pick.sitters;
      ranked = pick.result;
    } else {
      byes = pickByes(ctx, sitCount);
      ranked = orderOnCourt(ctx, onCourtFor(byes), null);
    }

    const matches: PlannedMatch[] = [];
    const groups = courtGroups(ranked, courtCount, ctx);
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
