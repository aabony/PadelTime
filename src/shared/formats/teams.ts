import type { EngineContext, PlannedMatch, RoundPlan } from "./types";
import { pairKey, shuffle } from "./types";
import { UNSET_LEVEL } from "../levels";

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
 * Pairs players who don't have a partner yet. With mixed pairs, a woman and a
 * man first. With grouping by level, players of the same level together;
 * otherwise strongest with weakest, so teams come out even. Players of equal
 * level are paired at random. An odd player out stays unpaired.
 */
export function autoPair(
  singles: string[],
  ctx: Pick<EngineContext, "levels" | "groupByLevel" | "genders" | "mixedPairs" | "rng">,
): Team[] {
  const level = (p: string) => ctx.levels?.[p] ?? UNSET_LEVEL;
  // Shuffle first so equal levels pair at random; the sort is stable.
  const strongestFirst = (xs: string[]) => shuffle([...xs], ctx.rng).sort((a, b) => level(b) - level(a));
  const pairUp = (xs: string[]): Team[] => {
    const out: Team[] = [];
    if (ctx.groupByLevel) {
      for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    } else {
      for (let i = 0, j = xs.length - 1; i < j; i++, j--) out.push([xs[i], xs[j]]);
    }
    return out;
  };
  if (!ctx.mixedPairs || !ctx.genders) return pairUp(strongestFirst(singles));
  const g = ctx.genders;
  const women = strongestFirst(singles.filter((p) => g[p] === "woman"));
  const men = strongestFirst(singles.filter((p) => g[p] === "man"));
  const k = Math.min(women.length, men.length);
  const teams: Team[] = [];
  for (let i = 0; i < k; i++) teams.push([women[i], ctx.groupByLevel ? men[i] : men[k - 1 - i]]);
  const rest = [...women.slice(k), ...men.slice(k), ...singles.filter((p) => !g[p])];
  return teams.concat(pairUp(strongestFirst(rest)));
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

/** Casual: pair up teams so they meet new opponents (and similar teams when grouping by level). */
function rotateCourts(
  playing: Team[],
  courtCount: number,
  ctx: EngineContext,
  restarts = Math.min(2000, 200 + playing.length * 100),
  ahead?: (courts: [Team, Team][]) => boolean,
): { courts: [Team, Team][]; cost: number } {
  let best: [Team, Team][] = [];
  let bestCost = Infinity;
  for (let i = 0; i < restarts && bestCost > 0; i++) {
    const order = shuffle([...playing], ctx.rng);
    const courts: [Team, Team][] = [];
    let cost = 0;
    for (let c = 0; c < courtCount; c++) {
      const [t1, t2] = [order[2 * c], order[2 * c + 1]];
      const m = meetings(t1, t2, ctx);
      cost += 10 * m * m;
      // Teams on the same sit-out rhythm are on court together every time, so they'll
      // have more chances to meet: spend the rarer match-ups first.
      if (sameRhythm(t1, t2, ctx)) cost += 1;
      if (ctx.groupByLevel && ctx.levels) cost += Math.abs(teamLevel(t1, ctx) - teamLevel(t2, ctx));
      courts.push([t1, t2]);
    }
    // Looking one round ahead: a fresh round now that forces a rematch next time is worse.
    if (ahead && cost < bestCost && cost < 10 && !ahead(courts)) cost += 5;
    if (cost < bestCost) {
      bestCost = cost;
      best = courts;
    }
  }
  return { courts: best, cost: bestCost };
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

/** Plans a round for fixed teams (ctx.teams): who sits, then who plays whom. */
export function planFixedTeams(ctx: EngineContext, mode: "rotate" | "ladder"): RoundPlan {
  const here = new Set(ctx.players);
  const teams = (ctx.teams ?? []).filter(([a, b]) => here.has(a) && here.has(b));
  const courtCount = Math.min(ctx.courts, Math.floor(teams.length / 2));
  if (courtCount === 0) return { matches: [], byes: [...ctx.players] };

  // Fairness by team: fewest sit-outs first, then whoever sat longest ago (the
  // pair's average, so a re-paired player carries their history).
  const fair = ([a, b]: Team) => [
    ((ctx.byeCounts[a] ?? 0) + (ctx.byeCounts[b] ?? 0)) / 2,
    Math.max(ctx.lastByeRound[a] ?? 0, ctx.lastByeRound[b] ?? 0),
  ];
  const sitCount = teams.length - courtCount * 2;
  const cmp = (fx: number[], fy: number[]) => fx[0] - fy[0] || fx[1] - fy[1];
  const byFairness = shuffle([...teams], ctx.rng).sort((x, y) => cmp(fair(x), fair(y)));
  let playing = byFairness.slice(sitCount);
  let rotated: [Team, Team][] | null = null;
  if (mode === "rotate") {
    // Match-ups played so far, for looking one round ahead.
    const met = new Set<string>();
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++) if (meetings(teams[i], teams[j], ctx) > 0) met.add(matchupKey(teams[i], teams[j]));
    // Sit-out choices for a round: everyone below the fairness cut-off sits, and
    // any `need` of the teams exactly at it (all of them when few, else a sample).
    const sitOptions = (key: (t: Team) => number[]): Team[][] => {
      if (sitCount === 0) return [[]];
      const sorted = [...teams].sort((x, y) => cmp(key(x), key(y)));
      const cut = key(sorted[sitCount - 1]);
      const below = sorted.filter((t) => cmp(key(t), cut) < 0);
      const tied = sorted.filter((t) => cmp(key(t), cut) === 0);
      const need = sitCount - below.length;
      const out: Team[][] = [];
      const pick = (from: number, chosen: Team[]) => {
        if (out.length >= 40) return;
        if (chosen.length === need) return void out.push([...below, ...chosen]);
        for (let i = from; i < tied.length; i++) pick(i + 1, [...chosen, tied[i]]);
      };
      pick(0, []);
      return out;
    };
    // Can next round still be all fresh match-ups, whoever the rotation sits next?
    const aheadFor = (sitting: Set<Team>) => (courts: [Team, Team][]) => {
      const after = new Set(met);
      for (const [t1, t2] of courts) after.add(matchupKey(t1, t2));
      const next = (t: Team) => (sitting.has(t) ? [fair(t)[0] + 1, ctx.roundNumber] : fair(t));
      return sitOptions(next).some((sit) => freshRoundPossible(teams.filter((t) => !sit.includes(t)), after));
    };
    // Teams exactly tied on fairness at the cut can swap places, so the teams on
    // court can still meet someone new (a fixed set of four may all have met).
    let best = rotateCourts(playing, courtCount, ctx, undefined, aheadFor(new Set(byFairness.slice(0, sitCount))));
    for (const sit of sitOptions(fair)) {
      if (best.cost === 0) break;
      const option = teams.filter((t) => !sit.includes(t));
      const tried = rotateCourts(option, courtCount, ctx, 150, aheadFor(new Set(sit)));
      if (tried.cost < best.cost) {
        best = tried;
        playing = option;
      }
    }
    rotated = best.courts;
  }
  const onCourt = new Set(playing.flat());

  const courts = rotated ?? ladderCourts(playing, courtCount, ctx);
  const matches: PlannedMatch[] = courts.map(([a, b], c) => ({ court: c + 1, a, b }));
  // Everyone else sits: sitting teams, plus anyone without a playable partner (roster order).
  return { matches, byes: ctx.players.filter((p) => !onCourt.has(p)) };
}
