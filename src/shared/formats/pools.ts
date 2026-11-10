import type { EngineContext, FormatStrategy, RoundPlan } from "./types";
import { americano } from "./americano";
import type { RoundRow } from "../types";

// The beginner court.
//
// One court — the organizer picks which (the first one rented by default) —
// is reserved for the players the organizer has tagged as newbies. They rotate
// among themselves Americano-style (fresh partner each round, sit-outs shared
// fairly) and keep their own table. Everyone else — the ladder — plays the
// session's format on the remaining courts and never shares a court with a
// newbie unless the organizer moves someone across (the tag is the only thing
// that moves a player between pools).
//
// One court is also the cap on newbies' court time: four play, the rest sit.
// When fewer than four newbies are here, the beginner court is topped up from
// the bottom of the ladder for that round, so it still runs and the mixing
// stays at the boundary.

/** The beginner court when a session hasn't chosen one: the first court. */
export const BEGINNER_COURT = 1;
/** Below this many checked-in players only one court fills anyway, so everyone plays as one pool. */
export const MIN_PLAYERS_FOR_POOLS = 8;

export type Pool = "beginner" | "ladder";

/** Which court (1-based, internal numbering) is the beginner court on this session: the chosen one, kept within the courts it has. */
export function beginnerCourtOf(s: { beginnerCourtNo?: number | null; courts: number }): number {
  const n = s.beginnerCourtNo ?? BEGINNER_COURT;
  return Math.min(Math.max(Math.floor(n) || BEGINNER_COURT, 1), Math.max(s.courts, 1));
}

/** Whether the beginner court runs this round (or, for display, on this night). */
export function poolsActive(o: {
  beginnerCourt: boolean;
  fixedTeams?: boolean;
  courts: number;
  eligible: number;
  newbies: number;
}): boolean {
  return o.beginnerCourt && !o.fixedTeams && o.courts >= 2 && o.newbies > 0 && o.eligible >= MIN_PLAYERS_FOR_POOLS;
}

export function poolOfCourt(court: number, beginnerCourt = BEGINNER_COURT): Pool {
  return court === beginnerCourt ? "beginner" : "ladder";
}

/** The rounds with only one pool's matches (what that pool's table and ranking are built from). */
export function poolRounds(rounds: RoundRow[], pool: Pool, beginnerCourt = BEGINNER_COURT): RoundRow[] {
  return rounds.map((r) => ({ ...r, matches: r.matches.filter((m) => poolOfCourt(m.court, beginnerCourt) === pool) }));
}

/** Ladder players best first (points per game, as the standings order them), players without results last. */
function ladderOrder(ctx: EngineContext, ladder: string[]): string[] {
  const rank = new Map(ctx.standings.map((s, i) => [s.playerId, i]));
  const pos = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...ladder].sort((x, y) => pos(x) - pos(y));
}

/** The ladder's courts in order: every court but the beginner one. */
export function ladderCourts(courts: number, beginnerCourt = BEGINNER_COURT): number[] {
  return Array.from({ length: courts }, (_, i) => i + 1).filter((c) => c !== beginnerCourt);
}

/**
 * Plan a round with the beginner court on: the beginner court from the newbie
 * pool (Americano rotation, no level grouping), the rest from the ladder with
 * the session's format, dealt across the other courts in order. Byes are the
 * two pools' sit-outs together.
 */
export function planWithPools(
  ctx: EngineContext,
  format: FormatStrategy,
  newbies: Iterable<string>,
  beginnerCourt = BEGINNER_COURT,
): RoundPlan {
  const tagged = new Set(newbies);
  const pool1 = ctx.players.filter((p) => tagged.has(p));
  let ladder = ctx.players.filter((p) => !tagged.has(p));
  const busy = new Set(ctx.busy ?? []);

  // Short of four newbies: the bottom of the ladder plays down this round
  // (never someone still finishing a game — they'd hold the court up).
  if (pool1.length < 4) {
    const fill = ladderOrder(ctx, ladder)
      .filter((p) => !busy.has(p))
      .slice(-(4 - pool1.length));
    const filling = new Set(fill);
    pool1.push(...fill);
    ladder = ladder.filter((p) => !filling.has(p));
  }

  const inPool = (ids: string[]) => {
    const set = new Set(ids);
    return (p: string) => set.has(p);
  };
  const beginner = americano.planRound({
    ...ctx,
    players: pool1,
    courts: 1,
    levels: undefined,
    groupByLevel: false,
    standings: [],
    teams: undefined,
    busy: ctx.busy?.filter(inPool(pool1)),
  });
  const rest = format.planRound({
    ...ctx,
    players: ladder,
    courts: ctx.courts - 1,
    standings: ctx.standings.filter((s) => ladder.includes(s.playerId)),
    teams: undefined,
    busy: ctx.busy?.filter(inPool(ladder)),
  });
  const others = ladderCourts(ctx.courts, beginnerCourt);
  return {
    matches: [
      ...beginner.matches.map((m) => ({ ...m, court: beginnerCourt })),
      ...rest.matches.map((m) => ({ ...m, court: others[m.court - 1] ?? m.court })),
    ],
    byes: [...beginner.byes, ...rest.byes],
  };
}
