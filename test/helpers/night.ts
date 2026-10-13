// Plays a whole night through a format planner the way the worker does:
// history and court ranking rebuilt from the rounds so far, scores invented
// from the players' levels (stronger team usually wins). Used by the tests to
// check grouping, fairness and the no-toggle equivalence over many nights.
import type { EngineContext, RoundPlan } from "../../src/shared/formats/types";
import { mulberry32 } from "../../src/shared/formats/types";
import { buildHistory } from "../../src/shared/history";
import { computeStandings, rankForCourts } from "../../src/shared/standings";
import type { RoundRow } from "../../src/shared/types";

export type Planner = (ctx: EngineContext) => RoundPlan;

export interface NightOptions {
  players: string[];
  courts: number;
  rounds: number;
  seed: number;
  points?: number;
  levels?: Record<string, number>;
  groupByLevel?: boolean;
  genders?: Record<string, "woman" | "man">;
  mixedPairs?: boolean;
}

export interface NightRound {
  plan: RoundPlan;
  /** Players on court this round with no result before it (their first game). */
  firstGame: Set<string>;
}

export function playNight(planner: Planner, o: NightOptions): NightRound[] {
  const rng = mulberry32(o.seed);
  const scoreRng = mulberry32(o.seed ^ 0x5eed);
  const points = o.points ?? 16;
  const strength = (id: string) => o.levels?.[id] ?? 3;
  const played: RoundRow[] = [];
  const out: NightRound[] = [];
  for (let n = 1; n <= o.rounds; n++) {
    const ranked = rankForCourts(computeStandings(o.players.map((id) => ({ id, name: id })), played)).filter(
      (r) => r.played > 0,
    );
    const ctx: EngineContext = {
      players: o.players,
      courts: o.courts,
      roundNumber: n,
      ...buildHistory(played),
      standings: ranked.map((r) => ({ playerId: r.playerId, points: r.points, diff: r.diff, played: r.played })),
      levels: o.levels,
      groupByLevel: o.groupByLevel,
      genders: o.genders,
      mixedPairs: o.mixedPairs,
      rng,
    };
    const plan = planner(ctx);
    const hasResult = new Set(ranked.map((r) => r.playerId));
    const firstGame = new Set(plan.matches.flatMap((m) => [...m.a, ...m.b]).filter((p) => !hasResult.has(p)));
    out.push({ plan, firstGame });
    played.push({
      id: `r${n}`,
      number: n,
      createdAt: n,
      byes: plan.byes,
      complete: true,
      matches: plan.matches.map((m, i) => {
        const edge = strength(m.a[0]) + strength(m.a[1]) - strength(m.b[0]) - strength(m.b[1]);
        const aWins = scoreRng() < 1 / (1 + Math.exp(-edge));
        const loser = Math.floor(scoreRng() * (points / 2 + 1));
        const [scoreA, scoreB] = aWins ? [points - loser, loser] : [loser, points - loser];
        return { id: `r${n}m${i}`, roundId: `r${n}`, court: m.court, a: m.a, b: m.b, scoreA, scoreB, status: "confirmed", submittedBy: null };
      }),
    });
  }
  return out;
}

/** Most minus fewest sit-outs across the roster. */
export function byeSpread(night: NightRound[], players: string[]): number {
  const byes = Object.fromEntries(players.map((p) => [p, 0]));
  for (const r of night) for (const p of r.plan.byes) byes[p]++;
  const counts = Object.values(byes);
  return Math.max(...counts) - Math.min(...counts);
}

/** True when a court of four has a beginner (2) alongside an intermediate/advanced player. */
export function mixesBeginners(four: string[], levels: Record<string, number>): boolean {
  const beg = four.map((p) => (levels[p] ?? 3) === 2);
  return beg.some(Boolean) && !beg.every(Boolean);
}

/** 18 players: six beginners, six intermediate, six advanced, in shuffled roster order. */
export function mixedRoster(seed: number, size = 18): { players: string[]; levels: Record<string, number> } {
  const rng = mulberry32(seed * 7919 + 1);
  const players = Array.from({ length: size }, (_, i) => `p${i + 1}`);
  const levels: Record<string, number> = {};
  const order = [...players];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((p, i) => (levels[p] = [2, 3, 4][Math.floor((i * 3) / size)]));
  return { players, levels };
}
