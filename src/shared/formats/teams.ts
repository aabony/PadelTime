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
 * Pairs players who don't have a partner yet. With mixed pairs, everyone of
 * the scarcer gender partners someone of the other first. With grouping by
 * level, partners are as close in level as possible; otherwise teams come out
 * as even as possible (stronger with weaker). Players of equal level are
 * paired at random. With an odd number, the last player on the list (usually
 * the last to arrive) stays unpaired.
 */
export function autoPair(
  singles: string[],
  ctx: Pick<EngineContext, "levels" | "groupByLevel" | "genders" | "mixedPairs" | "rng">,
): Team[] {
  const level = (p: string) => ctx.levels?.[p] ?? UNSET_LEVEL;
  // Shuffle first so equal levels pair at random; the sort is stable.
  const strongestFirst = (xs: string[]) => shuffle([...xs], ctx.rng).sort((a, b) => level(b) - level(a));
  const g = ctx.mixedPairs ? ctx.genders : undefined;
  const women = g ? singles.filter((p) => g[p] === "woman") : [];
  const men = g ? singles.filter((p) => g[p] === "man") : [];
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

  // How good a team is: level gap when grouping, else distance from an even team.
  const all = [...mixers, ...pool];
  const mean = all.reduce((sum, p) => sum + level(p), 0) / all.length;
  const cost = (a: string, b: string) => (ctx.groupByLevel ? (level(a) - level(b)) ** 2 : (level(a) + level(b) - 2 * mean) ** 2);

  // `order[i]` partners mixers[i] for i < k; after that, order pairs up two by two.
  const sorted = strongestFirst(pool);
  const order: string[] = [];
  const left = new Set(sorted);
  for (const m of mixers) {
    const choices = sorted.filter((p) => left.has(p) && opposite.has(p));
    const pick = ctx.groupByLevel
      ? choices.reduce((best, p) => (Math.abs(level(p) - level(m)) < Math.abs(level(best) - level(m)) ? p : best))
      : choices[choices.length - 1];
    order.push(pick);
    left.delete(pick);
  }
  const rest = sorted.filter((p) => left.has(p));
  if (ctx.groupByLevel) order.push(...rest);
  else for (let i = 0, j = rest.length - 1; i <= j; i++, j--) order.push(...(i === j ? [rest[i]] : [rest[i], rest[j]]));

  // Then swap any two players while that makes the teams better overall.
  const slotOf = (pos: number) => (pos < k ? pos : k + Math.floor((pos - k) / 2));
  const slotCost = (slot: number) =>
    slot < k ? cost(mixers[slot], order[slot]) : cost(order[k + 2 * (slot - k)], order[k + 2 * (slot - k) + 1]);
  for (let improved = true, pass = 0; improved && pass < 50; pass++) {
    improved = false;
    for (let a = 0; a < order.length; a++) {
      for (let b = a + 1; b < order.length; b++) {
        const slots = [...new Set([slotOf(a), slotOf(b)])];
        if (slots.length === 1) continue;
        if ((a < k || b < k) && !(opposite.has(order[a]) && opposite.has(order[b]))) continue;
        const before = slots.reduce((sum, s) => sum + slotCost(s), 0);
        [order[a], order[b]] = [order[b], order[a]];
        if (slots.reduce((sum, s) => sum + slotCost(s), 0) < before - 1e-9) improved = true;
        else [order[a], order[b]] = [order[b], order[a]];
      }
    }
  }
  const teams: Team[] = mixers.map((m, i) => [m, order[i]]);
  for (let i = k; i + 1 < order.length; i += 2) teams.push([order[i], order[i + 1]]);
  return teams;
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

/** Ways to choose `need` of `from`: all of them when few, else a random sample. */
function choose<T>(from: T[], need: number, rng: () => number, cap = 40): T[][] {
  const out: T[][] = [];
  let count = 1;
  for (let i = 0; i < need; i++) count = (count * (from.length - i)) / (i + 1);
  if (count <= cap) {
    const pick = (start: number, chosen: T[]) => {
      if (chosen.length === need) return void out.push(chosen);
      for (let i = start; i < from.length; i++) pick(i + 1, [...chosen, from[i]]);
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

  // Fairness by team: fewest sit-outs first, then whoever sat longest ago (the
  // pair's average, so a re-paired player carries their history).
  const fair = ([a, b]: Team) => [
    ((ctx.byeCounts[a] ?? 0) + (ctx.byeCounts[b] ?? 0)) / 2,
    Math.max(ctx.lastByeRound[a] ?? 0, ctx.lastByeRound[b] ?? 0),
  ];
  const sitCount = teams.length - courtCount * 2;
  const cmp = (fx: number[], fy: number[]) => fx[0] - fy[0] || fx[1] - fy[1];
  const byFairness = shuffle([...teams], ctx.rng).sort((x, y) => cmp(fair(x), fair(y)));

  // Who may sit: every team below the cut-off, plus any of the teams tied at it.
  // Strict ties match on sit-outs and on when they last sat (the plain rotation);
  // loose ties on sit-outs alone — any of those can sit without anyone sitting
  // more than anyone else. When exactly half the teams sit, the strict rotation
  // splits the night into two halves that never meet; loose ties mix them.
  const sitOptions = (key: (t: Team) => number[], loose: boolean): Team[][] => {
    if (sitCount === 0) return [[]];
    const sorted = shuffle([...teams], ctx.rng).sort((x, y) => cmp(key(x), key(y)));
    const cut = key(sorted[sitCount - 1]);
    const vs = (t: Team) => (loose ? key(t)[0] - cut[0] : cmp(key(t), cut));
    const below = sorted.filter((t) => vs(t) < 0);
    const tied = sorted.filter((t) => vs(t) === 0);
    return choose(tied, sitCount - below.length, ctx.rng).map((chosen) => [...below, ...chosen]);
  };
  // Sitting out twice in a row costs a little, and a loose choice a hair more
  // than the plain rotation: both only win when they mean fewer rematches.
  const satLast = (t: Team) => t.some((p) => ctx.lastByeRound[p] === ctx.roundNumber - 1);
  const sitCost = (sit: Team[], loose: boolean) => 3 * sit.filter(satLast).length + (loose ? 0.5 : 0);

  let best: { sit: Team[]; courts: [Team, Team][]; cost: number };
  if (mode === "rotate") {
    // Match-ups played so far, for looking one round ahead.
    const met = new Set<string>();
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++) if (meetings(teams[i], teams[j], ctx) > 0) met.add(matchupKey(teams[i], teams[j]));
    // Can next round still be all fresh match-ups, whoever sits next?
    const aheadFor = (sitting: Set<Team>) => (courts: [Team, Team][]) => {
      const after = new Set(met);
      for (const [t1, t2] of courts) after.add(matchupKey(t1, t2));
      const next = (t: Team) => (sitting.has(t) ? [fair(t)[0] + 1, ctx.roundNumber] : fair(t));
      return sitOptions(next, true).some((sit) => freshRoundPossible(teams.filter((t) => !sit.includes(t)), after));
    };
    const tryRound = (sit: Team[], extra: number, restarts?: number) => {
      const r = rotateCourts(teams.filter((t) => !sit.includes(t)), courtCount, ctx, restarts, aheadFor(new Set(sit)));
      return { sit, courts: r.courts, cost: r.cost + extra };
    };
    const base = byFairness.slice(0, sitCount);
    best = tryRound(base, sitCost(base, false));
    for (const loose of [false, true]) {
      for (const sit of sitOptions(fair, loose)) {
        if (best.cost === 0) break;
        const extra = sitCost(sit, loose);
        if (extra >= best.cost) continue;
        const tried = tryRound(sit, extra, 150);
        if (tried.cost < best.cost) best = tried;
      }
    }
  } else {
    const tryRound = (sit: Team[], extra: number) => {
      const courts = ladderCourts(teams.filter((t) => !sit.includes(t)), courtCount, ctx);
      return { sit, courts, cost: courts.reduce((sum, [a, b]) => sum + 10 * meetings(a, b, ctx) ** 2, 0) + extra };
    };
    const base = byFairness.slice(0, sitCount);
    best = tryRound(base, sitCost(base, false));
    for (const loose of [false, true]) {
      for (const sit of sitOptions(fair, loose)) {
        if (best.cost === 0) break;
        const extra = sitCost(sit, loose);
        if (extra >= best.cost) continue;
        const tried = tryRound(sit, extra);
        if (tried.cost < best.cost) best = tried;
      }
    }
  }

  const matches: PlannedMatch[] = best.courts.map(([a, b], c) => ({ court: c + 1, a, b }));
  const onCourt = new Set(best.courts.flat(2));
  // Everyone else sits: sitting teams, plus anyone without a playable partner (roster order).
  return { matches, byes: ctx.players.filter((p) => !onCourt.has(p)) };
}
