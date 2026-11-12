// The drop: with Competitive sit-outs on, the first rounds rotate sit-outs
// fairly, and from the round after "drop after round N" the lowest points per
// game sit while the top of the table keeps playing. The round is the
// organizer's choice, so the night can count down to it.

import { pointsPerGame } from "./standings";

/** The rounds an organizer can pick for the drop. */
export const DROP_AFTER_CHOICES = [2, 3, 4, 5, 6] as const;
export const DEFAULT_DROP_AFTER = 3;

/** A stored or submitted "drop after round" as a usable round number. */
export function normalizeDropAfter(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_DROP_AFTER;
  return Math.min(Math.max(Math.round(n), 1), 30);
}

/** Whether the table (not the fair rotation) decides who sits in this round. */
export function dropOn(afterRound: number, roundNumber: number): boolean {
  return roundNumber > afterRound;
}

export interface DropCountdown {
  /** counting: fair rounds still to come after this one · last: this is the last fair round · on: the table decides. */
  state: "counting" | "last" | "on";
  afterRound: number;
  /** Fair rounds left, the one being played included (0 once the drop is on). */
  roundsLeft: number;
  /** Fair rounds fully behind us, for the bar. */
  done: number;
}

/** Where the night stands against the drop, from the round being played (0 before round 1). */
export function dropCountdown(afterRound: number, playingRound: number): DropCountdown {
  const round = Math.max(playingRound, 1);
  if (dropOn(afterRound, round)) return { state: "on", afterRound, roundsLeft: 0, done: afterRound };
  const roundsLeft = afterRound - round + 1;
  return { state: roundsLeft === 1 ? "last" : "counting", afterRound, roundsLeft, done: round - 1 };
}

/**
 * What someone still in their first game counts as when the drop ranks the
 * table: the average of everyone who has a result. The round on deck is dealt
 * while they're playing, so there's nothing to judge yet — they're neither
 * dropped first nor handed a place, and take their turn among themselves.
 */
export function averageResult(rows: { points: number; played: number }[]): number {
  const known = rows.filter((r) => r.played > 0);
  return known.length ? known.reduce((sum, r) => sum + r.points / r.played, 0) / known.length : 0;
}

/**
 * Who is below the cut as the table stands: of the players in the draw, the
 * `sitting` the engine would bench — lowest points per game first. Ties go to
 * more points, then the better difference (the engine breaks exact ties by
 * whose turn it is to sit).
 *
 * The drop: someone never dealt a game (`owedAGame`, a late arrival) plays
 * before anyone is ranked out, and someone still in their first game counts
 * as average and isn't marked — there's no result to judge yet. Finals: no
 * such grace; anyone without a result is out with the rest.
 */
export function belowTheCut(
  rows: { playerId: string; points: number; diff: number; played: number }[],
  inDraw: string[],
  sitting: number,
  opts: { finals?: boolean; owedAGame?: string[] } = {},
): Set<string> {
  if (sitting <= 0) return new Set();
  const row = new Map(rows.map((r) => [r.playerId, r]));
  const owed = new Set(opts.finals ? [] : (opts.owedAGame ?? []));
  const hasResult = (id: string) => (row.get(id)?.played ?? 0) > 0;
  const unknown = opts.finals ? -1 : averageResult(inDraw.flatMap((id) => row.get(id) ?? []));
  const avg = (id: string) => (owed.has(id) ? Number.MAX_SAFE_INTEGER : hasResult(id) ? pointsPerGame(row.get(id)!) : unknown);
  const bench = [...inDraw]
    .sort((a, b) => avg(a) - avg(b) || (row.get(a)?.points ?? 0) - (row.get(b)?.points ?? 0) || (row.get(a)?.diff ?? 0) - (row.get(b)?.diff ?? 0))
    .slice(0, sitting);
  return new Set(bench.filter((id) => opts.finals || hasResult(id)));
}
