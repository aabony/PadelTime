import type { EngineContext, PlannedMatch, RoundPlan } from "./types";
import { pairKey, shuffle } from "./types";
import { UNSET_LEVEL } from "../levels";
import { waitingCourts } from "./byes";

// "Keep teams together" (session switch): partners play the whole night as a
// fixed pair, for either style.
//  - Casual (rotate): teams meet as many different teams as possible — a
//    round robin, with the level gap between teams kept small when grouping.
//  - Competitive (ladder): teams ranked by points per game, top two teams on
//    court 1, the next two on court 2… avoiding a rematch when a swap with the
//    neighbouring court does.
//  - Sit-outs go by team: the pair that has sat out least plays (both partners
//    always sit together). Players without a playable partner — unpaired, or
//    their partner isn't here — sit out until that changes.

export type Team = [string, string];

/**
 * Pairs players who don't have a partner yet. With mixed pairs, everyone of
 * the scarcer gender partners someone of the other. With grouping by level,
 * partners are as close in level as possible; otherwise teams come out as even
 * as possible (stronger with weaker). Players of equal level are paired at
 * random. With an odd number, the last player on the list (usually the last to
 * arrive) stays unpaired.
 */
export function autoPair(
  singles: string[],
  ctx: Pick<EngineContext, "levels" | "groupByLevel" | "genders" | "mixedPairs" | "rng">,
): Team[] {
  const level = (p: string) => ctx.levels?.[p] ?? UNSET_LEVEL;
  // Shuffled first so equal levels pair at random; the sorts are stable.
  const strongestFirst = (xs: string[]) => [...xs].sort((a, b) => level(b) - level(a));
  const shuffled = shuffle([...singles], ctx.rng);
  const g = ctx.mixedPairs ? ctx.genders : undefined;
  const women = g ? shuffled.filter((p) => g[p] === "woman") : [];
  const men = g ? shuffled.filter((p) => g[p] === "man") : [];
  const [fewer, more] = women.length <= men.length ? [women, men] : [men, women];
  const mixers = strongestFirst(fewer);
  const k = mixers.length;
  const opposite = new Set(more);
  let pool = singles.filter((p) => !mixers.includes(p));
  if ((pool.length - k) % 2 === 1) {
    const spare = [...pool].reverse().find((p) => !opposite.has(p) || opposite.size > k);
    pool = pool.filter((p) => p !== spare);
  }
  if (k + pool.length < 2) return [];
  const inPool = new Set(pool);
  const sorted = strongestFirst(shuffled.filter((p) => inPool.has(p)));

  // How good a team is (pairCost below): level gap when grouping, else distance from an even team.
  const all = [...mixers, ...pool];
  const mean = all.reduce((sum, p) => sum + level(p), 0) / all.length;
  // Pairing a sorted list: neighbours when grouping, else strongest with weakest — the best possible either way.
  const pairOff = (xs: string[], ys = xs): Team[] => {
    const out: Team[] = [];
    if (xs !== ys) return xs.map((x, i) => [x, ctx.groupByLevel ? ys[i] : ys[ys.length - 1 - i]]);
    if (ctx.groupByLevel) for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    else for (let i = 0, j = xs.length - 1; i < j; i++, j--) out.push([xs[i], xs[j]]);
    return out;
  };

  // Players of one level are interchangeable, so trying every split by level of
  // who partners the mixers finds the best teams. Each split is scored from level
  // counts alone; teams are built once, for the best.
  const levelsDown = [...new Set(sorted.map(level))];
  const countOf = (pick: (p: string) => boolean) => levelsDown.map((lv) => sorted.filter((p) => pick(p) && level(p) === lv).length);
  const oppCount = countOf((p) => opposite.has(p));
  const otherCount = countOf((p) => !opposite.has(p));
  const mixerLevels = mixers.map(level);
  const pairCost = (a: number, b: number) => (ctx.groupByLevel ? (a - b) ** 2 : (a + b - 2 * mean) ** 2);
  const expand = (counts: number[]) => levelsDown.flatMap((lv, j) => new Array<number>(counts[j]).fill(lv));
  const take = new Array<number>(levelsDown.length).fill(0);
  let bestTake = [...take];
  let bestCost = Infinity;
  const visit = (j: number, left: number) => {
    if (j === levelsDown.length) {
      if (left > 0) return;
      const chosen = expand(take);
      const rest = expand(take.map((t, i) => oppCount[i] - t + otherCount[i]));
      let total = 0;
      for (let i = 0; i < k; i++) total += pairCost(mixerLevels[i], chosen[ctx.groupByLevel ? i : k - 1 - i]);
      if (ctx.groupByLevel) for (let i = 0; i + 1 < rest.length; i += 2) total += pairCost(rest[i], rest[i + 1]);
      else for (let i = 0, e = rest.length - 1; i < e; i++, e--) total += pairCost(rest[i], rest[e]);
      if (total < bestCost - 1e-9) [bestTake, bestCost] = [[...take], total];
      return;
    }
    for (let c = Math.min(oppCount[j], left); c >= 0; c--) {
      take[j] = c;
      visit(j + 1, left - c);
    }
  };
  visit(0, k);
  const chosen = levelsDown.flatMap((lv, j) => sorted.filter((p) => opposite.has(p) && level(p) === lv).slice(0, bestTake[j]));
  const picked = new Set(chosen);
  return [...pairOff(mixers, chosen), ...pairOff(sorted.filter((p) => !picked.has(p)))];
}

/** Times two teams have met (each pairing across the net counts the same for a fixed team). */
function meetings(t1: Team, t2: Team, ctx: EngineContext): number {
  let n = 0;
  for (const x of t1) for (const y of t2) n += ctx.opponentCounts[pairKey(x, y)] ?? 0;
  return n / 4;
}

/** Same sit-out count and last sit-out round: the rotation keeps these two in step. */
function sameRhythm(t1: Team, t2: Team, ctx: EngineContext): boolean {
  const key = ([a, b]: Team) => `${(ctx.byeCounts[a] ?? 0) + (ctx.byeCounts[b] ?? 0)}|${Math.max(ctx.lastByeRound[a] ?? 0, ctx.lastByeRound[b] ?? 0)}`;
  return key(t1) === key(t2);
}

function teamLevel(t: Team, ctx: EngineContext): number {
  return t.reduce((s, p) => s + (ctx.levels?.[p] ?? UNSET_LEVEL), 0);
}

/**
 * Whether the match-ups nobody has played yet can still pair up all these
 * teams in one round (a quick backtracking search; a night has a handful of teams).
 */
const matchupKey = (t1: Team, t2: Team) => [pairKey(...t1), pairKey(...t2)].sort().join("~");

function freshRoundPossible(teams: Team[], played: Set<string>): boolean {
  const used = new Array<boolean>(teams.length).fill(false);
  const fresh = (i: number, j: number) => !played.has(matchupKey(teams[i], teams[j]));
  const search = (): boolean => {
    const i = used.indexOf(false);
    if (i === -1) return true;
    used[i] = true;
    for (let j = i + 1; j < teams.length; j++) {
      if (used[j] || !fresh(i, j)) continue;
      used[j] = true;
      if (search()) return true;
      used[j] = false;
    }
    used[i] = false;
    return false;
  };
  return search();
}

/** A round that forces a rematch next round: nearly as bad as one now, so it's put off rather than walked into. */
const AHEAD = 9.5;

/** Casual: pair up teams so they meet new opponents (and similar teams when grouping by level). */
function rotateCourts(
  playing: Team[],
  courtCount: number,
  ctx: EngineContext,
  restarts = Math.min(2000, 200 + playing.length * 100),
  ahead?: (courts: [Team, Team][]) => boolean,
): { courts: [Team, Team][]; cost: number; rematch: number } {
  let best: [Team, Team][] = [];
  let bestCost = Infinity;
  let bestRematch = Infinity;
  for (let i = 0; i < restarts && bestCost > 0; i++) {
    const order = shuffle([...playing], ctx.rng);
    const courts: [Team, Team][] = [];
    let rematch = 0;
    let cost = 0;
    for (let c = 0; c < courtCount; c++) {
      const [t1, t2] = [order[2 * c], order[2 * c + 1]];
      const m = meetings(t1, t2, ctx);
      rematch += 10 * m * m;
      // Teams on the same sit-out rhythm are on court together every time, so they'll
      // have more chances to meet: spend the rarer match-ups first.
      if (sameRhythm(t1, t2, ctx)) cost += 1;
      if (ctx.groupByLevel && ctx.levels) cost += Math.abs(teamLevel(t1, ctx) - teamLevel(t2, ctx));
      // Dealing ahead: a court that has to wait for a team still finishing elsewhere.
      cost += 30 * waitingCourts(ctx, [[...t1, ...t2]]);
      courts.push([t1, t2]);
    }
    // Looking one round ahead: a fresh round now that forces a rematch next time is worse.
    if (ahead && rematch + cost < bestCost && rematch < 10 && !ahead(courts)) rematch += AHEAD;
    cost += rematch;
    if (cost < bestCost) {
      [bestCost, bestRematch] = [cost, rematch];
      best = courts;
    }
  }
  return { courts: best, cost: bestCost, rematch: bestRematch };
}

/** Competitive: the team ladder — best two teams on court 1, and so on. */
function ladderCourts(playing: Team[], courtCount: number, ctx: EngineContext): [Team, Team][] {
  const perGame = new Map(ctx.standings.map((s) => [s.playerId, s.played ? s.points / s.played : s.points]));
  const hasResults = (t: Team) => t.some((p) => perGame.has(p));
  const score = (t: Team) => {
    const known = t.filter((p) => perGame.has(p)).map((p) => perGame.get(p)!);
    return known.reduce((a, b) => a + b, 0) / known.length;
  };
  const anyResults = playing.some(hasResults);
  // Teams with results by their record; teams without (round 1, newcomers) by
  // level when grouping, otherwise at random — newcomers below teams with results.
  const key = (t: Team) =>
    hasResults(t) ? [0, -score(t)] : [anyResults ? 1 : 0, ctx.groupByLevel && ctx.levels ? -teamLevel(t, ctx) : 0];
  const ranked = shuffle([...playing], ctx.rng).sort((x, y) => {
    const [a, b] = [key(x), key(y)];
    return a[0] - b[0] || a[1] - b[1];
  });
  const courts: [Team, Team][] = Array.from({ length: courtCount }, (_, c) => [ranked[2 * c], ranked[2 * c + 1]]);
  // A rematch on one court: swap with the neighbouring court if that means fewer meetings overall.
  for (let c = 0; c + 1 < courts.length; c++) {
    const [a, b] = courts[c];
    const [d, e] = courts[c + 1];
    const now = meetings(a, b, ctx) + meetings(d, e, ctx);
    if (now === 0) continue;
    const swapped = meetings(a, d, ctx) + meetings(b, e, ctx);
    if (swapped < now) {
      courts[c] = [a, d];
      courts[c + 1] = [b, e];
    }
  }
  return courts;
}

/** Ways to choose `need` of `from`: all of them when few, else a random sample. */
function choose<T>(from: T[], need: number, rng: () => number, cap = 40): T[][] {
  if (need <= 0) return [[]];
  if (need >= from.length) return [[...from]];
  let count = 1;
  for (let i = 0; i < need; i++) count = (count * (from.length - i)) / (i + 1);
  const out: T[][] = [];
  if (count <= cap) {
    const pick = (start: number, chosen: T[]) => {
      if (chosen.length === need) return void out.push(chosen);
      // Stop early when too few are left to fill the choice.
      for (let i = start; i <= from.length - (need - chosen.length); i++) pick(i + 1, [...chosen, from[i]]);
    };
    pick(0, []);
    return out;
  }
  const seen = new Set<string>();
  for (let tries = 0; out.length < cap && tries < cap * 4; tries++) {
    const idx = shuffle(from.map((_, i) => i), rng).slice(0, need).sort((a, b) => a - b);
    if (seen.has(idx.join())) continue;
    seen.add(idx.join());
    out.push(idx.map((i) => from[i]));
  }
  return out;
}

/** Plans a round for fixed teams (ctx.teams): who sits, then who plays whom. */
export function planFixedTeams(ctx: EngineContext, mode: "rotate" | "ladder"): RoundPlan {
  const here = new Set(ctx.players);
  const teams = (ctx.teams ?? []).filter(([a, b]) => here.has(a) && here.has(b));
  const courtCount = Math.min(ctx.courts, Math.floor(teams.length / 2));
  if (courtCount === 0) return { matches: [], byes: [...ctx.players] };

  // Fairness by team: fewest sit-outs first (the pair's average, so a re-paired
  // player carries their history), then whoever was on court most recently.
  // Without the court history: whoever sat longest ago.
  const history = ctx.courtRounds;
  const lastOnCourt = new Map<string, number>();
  history?.forEach((ids, i) => ids.forEach((p) => lastOnCourt.set(p, i + 1)));
  const byes = ([a, b]: Team) => ((ctx.byeCounts[a] ?? 0) + (ctx.byeCounts[b] ?? 0)) / 2;
  // Dealing ahead, a team still finishing a game sits before others equally due.
  const busy = new Set(ctx.busy ?? []);
  const fair = (t: Team) => [
    byes(t),
    t.some((p) => busy.has(p)) ? 0 : 1,
    history ? -Math.max(...t.map((p) => lastOnCourt.get(p) ?? 0)) : Math.max(...t.map((p) => ctx.lastByeRound[p] ?? 0)),
  ];
  const sitCount = teams.length - courtCount * 2;
  const cmp = (fx: number[], fy: number[]) => fx[0] - fy[0] || fx[1] - fy[1] || fx[2] - fy[2];
  const byFairness = shuffle([...teams], ctx.rng).sort((x, y) => cmp(fair(x), fair(y)));

  // Who may sit: every team below the cut-off, plus any of the teams tied at it.
  // Strict ties match on both fairness keys (the plain rotation); loose ties on
  // sit-outs alone — any of those can sit without anyone sitting more than anyone else.
  const sitOptions = (key: (t: Team) => number[], loose: boolean): Team[][] => {
    if (sitCount === 0) return [[]];
    const sorted = shuffle([...teams], ctx.rng).sort((x, y) => cmp(key(x), key(y)));
    const cut = key(sorted[sitCount - 1]);
    const vs = (t: Team) => (loose ? key(t)[0] - cut[0] : cmp(key(t), cut));
    const below = sorted.filter((t) => vs(t) < 0);
    const tied = sorted.filter((t) => vs(t) === 0);
    return choose(tied, sitCount - below.length, ctx.rng).map((chosen) => [...below, ...chosen]);
  };
  // What a sit-out choice costs, next to rematches (10 each):
  //  - a run of sit-outs longer than the night's natural rhythm (1 round between
  //    games when at most half sit, 2 when two thirds sit…): 3 for one round over,
  //    9 for two, 18 for three — so one or two extra rounds can dodge a rematch;
  //  - a loose choice: a hair;
  //  - the same group on court as one cycle ago. When the teams split into whole
  //    groups (8 teams, 4 on court: two halves), the plain rotation brings the same
  //    groups back cycle after cycle and they'd never meet; this swaps about half
  //    of a returning group for others.
  const perRound = courtCount * 2;
  const natural = Math.max(1, Math.ceil(teams.length / perRound) - 1);
  const sittingFor = (t: Team) =>
    history
      ? history.length + 1 - Math.max(...t.map((p) => lastOnCourt.get(p) ?? 0))
      : t.some((p) => ctx.lastByeRound[p] === ctx.roundNumber - 1)
        ? 2
        : 1;
  const cycle = teams.length % perRound === 0 ? teams.length / perRound : 0;
  const cycleAgo = new Set(cycle > 1 ? (history?.at(-cycle) ?? []) : []);
  const sitCost = (sit: Team[], loose: boolean) => {
    const back = teams.filter((t) => !sit.includes(t) && t.every((p) => cycleAgo.has(p))).length;
    const streaks = sit.reduce((sum, t) => {
      const over = sittingFor(t) - natural;
      return sum + (over > 0 ? 1.5 * over * (over + 1) : 0);
    }, 0);
    return streaks + (loose ? 0.5 : 0) + 4 * Math.max(0, back - Math.ceil(perRound / 2));
  };

  // Options compare on rematches + sit-out costs first; level gaps and rhythm only break ties.
  type Option = { courts: [Team, Team][]; first: number; then: number };
  const better = (x: Option, y: Option) => x.first < y.first - 1e-9 || (x.first < y.first + 1e-9 && x.then < y.then - 1e-9);
  // Match-ups played so far, for looking one round ahead.
  const met = new Set<string>();
  for (let i = 0; i < teams.length; i++)
    for (let j = i + 1; j < teams.length; j++) if (meetings(teams[i], teams[j], ctx) > 0) met.add(matchupKey(teams[i], teams[j]));
  // Can next round still be all fresh match-ups, whoever sits next?
  const aheadFor = (sitting: Set<Team>) => (courts: [Team, Team][]) => {
    const after = new Set(met);
    for (const [t1, t2] of courts) after.add(matchupKey(t1, t2));
    const next = (t: Team) =>
      sitting.has(t)
        ? [fair(t)[0] + 1, 1, history ? fair(t)[2] : ctx.roundNumber]
        : [fair(t)[0], 1, history ? -(history.length + 1) : fair(t)[2]];
    return sitOptions(next, true).some((sit) => freshRoundPossible(teams.filter((t) => !sit.includes(t)), after));
  };
  let tryRound: (sit: Team[], extra: number, restarts?: number) => Option;
  if (mode === "rotate") {
    tryRound = (sit, extra, restarts) => {
      const r = rotateCourts(teams.filter((t) => !sit.includes(t)), courtCount, ctx, restarts, aheadFor(new Set(sit)));
      return { courts: r.courts, first: r.rematch + extra, then: r.cost - r.rematch };
    };
  } else {
    tryRound = (sit, extra) => {
      const courts = ladderCourts(teams.filter((t) => !sit.includes(t)), courtCount, ctx);
      let rematch = courts.reduce((sum, [a, b]) => sum + 10 * meetings(a, b, ctx) ** 2, 0);
      // The ladder decides who plays whom; who sits is ours, so steer clear of a forced rematch next round.
      if (sitCount > 0 && rematch < 10 && !aheadFor(new Set(sit))(courts)) rematch += AHEAD;
      return { courts, first: rematch + extra, then: 0 };
    };
  }
  const base = byFairness.slice(0, sitCount);
  let best = tryRound(base, sitCost(base, false));
  const tried = new Set([base.map((t) => t[0]).sort().join()]);
  for (const loose of [false, true]) {
    for (const sit of sitOptions(fair, loose)) {
      if (best.first === 0 && best.then === 0) break;
      const id = sit.map((t) => t[0]).sort().join();
      if (tried.has(id)) continue;
      tried.add(id);
      const extra = sitCost(sit, loose);
      if (extra > best.first + 1e-9) continue;
      const option = tryRound(sit, extra, 150);
      if (better(option, best)) best = option;
    }
  }

  const matches: PlannedMatch[] = best.courts.map(([a, b], c) => ({ court: c + 1, a, b }));
  const onCourt = new Set(best.courts.flat(2));
  // Everyone else sits: sitting teams, plus anyone without a playable partner (roster order).
  return { matches, byes: ctx.players.filter((p) => !onCourt.has(p)) };
}
