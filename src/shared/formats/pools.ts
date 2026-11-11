import type { EngineContext, FormatStrategy, RoundPlan } from "./types";
import { americano } from "./americano";
import type { MatchRow, RoundRow } from "../types";

// The beginner court.
//
// One court — the organizer picks which (the first one rented by default) —
// is set aside for the players the organizer has tagged as newbies. Everyone
// else — the ladder — plays the session's format on the remaining courts and
// never shares a court with a newbie unless the organizer moves someone across
// (the tag is the only thing that moves a player between pools).
//
// Two ways to run that court:
// - Games: the newbies rotate among themselves Americano-style (fresh partner
//   each game, sit-outs shared fairly) and keep their own table. Their games
//   are their own sequence — the "beginner track" — dealt one at a time as
//   each score comes in, so the court runs on its own clock and never holds up
//   the main rounds. It needs four newbies; with fewer the court is an
//   ordinary court and everyone plays one draw.
// - Coaching: the newbies train with a coach and aren't dealt any games.
//
// Either way the main rounds are dealt from the ladder alone, on the other
// courts.

/** The beginner court when a session hasn't chosen one: the first court. */
export const BEGINNER_COURT = 1;
/** Below this many checked-in players only one court fills anyway, so everyone plays as one pool. */
export const MIN_PLAYERS_FOR_POOLS = 8;
/** A game needs four: fewer newbies than this and the beginner court doesn't run. */
export const MIN_NEWBIES_FOR_COURT = 4;
/**
 * Beginner-track games are stored as rounds numbered from here up, so they
 * never collide with the main rounds' numbers (one unique index covers both).
 * Game n is stored as BEGINNER_TRACK_BASE + n.
 */
export const BEGINNER_TRACK_BASE = 1000;

export type Pool = "beginner" | "ladder";

/** Which court (1-based, internal numbering) is the beginner court on this session: the chosen one, kept within the courts it has. */
export function beginnerCourtOf(s: { beginnerCourtNo?: number | null; courts: number }): number {
  const n = s.beginnerCourtNo ?? BEGINNER_COURT;
  return Math.min(Math.max(Math.floor(n) || BEGINNER_COURT, 1), Math.max(s.courts, 1));
}

/** Whether the beginner court runs its own games tonight: the toggle, four newbies here, and enough players overall. */
export function poolsActive(o: {
  beginnerCourt: boolean;
  fixedTeams?: boolean;
  courts: number;
  eligible: number;
  newbies: number;
}): boolean {
  return o.beginnerCourt && !o.fixedTeams && o.courts >= 2 && o.newbies >= MIN_NEWBIES_FOR_COURT && o.eligible >= MIN_PLAYERS_FOR_POOLS;
}

/**
 * Whether the beginner court is a coached court tonight: the players tagged
 * Newbie train there with a coach and are left out of the draw; the tournament
 * runs on the other courts. Unlike the games court it needs no minimum — the
 * court is booked for the coach whoever turns up.
 */
export function coachedActive(o: { beginnerCourt: boolean; coached: boolean; fixedTeams?: boolean; courts: number }): boolean {
  return o.beginnerCourt && o.coached && !o.fixedTeams && o.courts >= 2;
}

export function poolOfCourt(court: number, beginnerCourt = BEGINNER_COURT): Pool {
  return court === beginnerCourt ? "beginner" : "ladder";
}

/**
 * Which pool a match counts for. Rounds say so themselves: a beginner-track
 * game is the beginners', a main round is the ladder's whatever its courts.
 * Rounds dealt before the tracks existed held both, split by court.
 */
export function poolOfMatch(round: Pick<RoundRow, "track">, match: Pick<MatchRow, "court">, beginnerCourt = BEGINNER_COURT): Pool {
  if (round.track === "beginner") return "beginner";
  if (round.track === "main") return "ladder";
  return poolOfCourt(match.court, beginnerCourt);
}

/** The rounds with only one pool's matches (what that pool's table and ranking are built from). */
export function poolRounds(rounds: RoundRow[], pool: Pool, beginnerCourt = BEGINNER_COURT): RoundRow[] {
  return rounds.map((r) => ({ ...r, matches: r.matches.filter((m) => poolOfMatch(r, m, beginnerCourt) === pool) }));
}

/** The ladder's courts in order: every court but the beginner one. */
export function ladderCourts(courts: number, beginnerCourt = BEGINNER_COURT): number[] {
  return Array.from({ length: courts }, (_, i) => i + 1).filter((c) => c !== beginnerCourt);
}

/**
 * Plan a main round with the beginner court set aside (games or coaching):
 * the tagged newbies are out of the draw; everyone else plays the session's
 * format on the other courts, in order. Nobody is dealt onto the beginner court.
 */
export function planCoached(
  ctx: EngineContext,
  format: FormatStrategy,
  newbies: Iterable<string>,
  coachedCourt = BEGINNER_COURT,
): RoundPlan {
  const tagged = new Set(newbies);
  const playing = ctx.players.filter((p) => !tagged.has(p));
  const inDraw = new Set(playing);
  const plan = format.planRound({
    ...ctx,
    players: playing,
    courts: ctx.courts - 1,
    standings: ctx.standings.filter((s) => inDraw.has(s.playerId)),
    busy: ctx.busy?.filter((p) => inDraw.has(p)),
  });
  const others = ladderCourts(ctx.courts, coachedCourt);
  return { matches: plan.matches.map((m) => ({ ...m, court: others[m.court - 1] ?? m.court })), byes: plan.byes };
}

/**
 * The beginner court's next game: four of the newbies (`ctx.players`), dealt
 * Americano-style from the beginner track's own history — fresh partners,
 * sit-outs shared fairly — with no level grouping and no ladder standings.
 */
export function planBeginnerGame(ctx: EngineContext, beginnerCourt = BEGINNER_COURT): RoundPlan {
  const plan = americano.planRound({
    ...ctx,
    courts: 1,
    levels: undefined,
    groupByLevel: false,
    standings: [],
    teams: undefined,
    busy: undefined,
  });
  return { matches: plan.matches.map((m) => ({ ...m, court: beginnerCourt })), byes: plan.byes };
}
