// Pacing, measured on a real night (rounds dealt 4:12, 4:29, 4:42, 4:56, 5:12):
// a 24-point round takes ~15 min including score entry — half a minute per
// point plus a changeover. Play starts ~10 min into the booking (arrivals,
// check-in), so that much is set aside before counting rounds.
export function minutesPerMatch(pointsPerMatch: number): number {
  return Math.round(pointsPerMatch * 0.5) + 3;
}

export const SETUP_MINUTES = 10;

export interface NightPlan {
  minutesPerMatch: number;
  /** Rounds that fit the court time; null when no duration is set. */
  rounds: number | null;
  courtsUsed: number;
  onCourt: number;
  sitting: number;
  /** Share of rounds each player is on court (0–1). */
  playShare: number;
  matchesPerPlayer: number | null;
  sitOutsPerPlayer: number | null;
  /** Roughly how long each player spends off court over the night. */
  breakMinutes: number | null;
}

/** What a night looks like for a given roster, courts, court time and points. */
export function planNight(players: number, courts: number, durationMin: number | null | undefined, points: number): NightPlan {
  const mpm = minutesPerMatch(points);
  const rounds = estimateRounds(durationMin, points);
  const courtsUsed = Math.min(courts, Math.floor(players / 4));
  const onCourt = courtsUsed * 4;
  const sitting = Math.max(0, players - onCourt);
  const playShare = players > 0 && courtsUsed > 0 ? onCourt / players : 0;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const matchesPerPlayer = rounds == null ? null : round1(rounds * playShare);
  const sitOutsPerPlayer = rounds == null ? null : round1(rounds * (1 - playShare));
  return {
    minutesPerMatch: mpm,
    rounds,
    courtsUsed,
    onCourt,
    sitting,
    playShare,
    matchesPerPlayer,
    sitOutsPerPlayer,
    breakMinutes: sitOutsPerPlayer == null ? null : Math.round(sitOutsPerPlayer * mpm),
  };
}

export interface Recommendation {
  courts: number;
  points: number;
  rounds: number | null;
  /** Everyone gets the same number of games (so a total-points table is fair). */
  equalGames: boolean;
  /** Games each when equal; null when they can't be (or no duration is set). */
  gamesEach: number | null;
  /** Stop after this round for equal games, when that's one round short of what fits; else null. */
  stopAfter: number | null;
}

/** Points values the suggestion picks from, longest game first. */
export const POINT_OPTIONS = [24, 21, 18, 16, 14, 12, 10] as const;

export type Priority = "playing" | "social";

/**
 * What to run. Playing: every court you can fill. Social: courts chosen so
 * roughly 30% of the group sits each round (never more than 40%) — a sit-out
 * lasts one round, so shorter games keep those breaks short.
 *
 * Points: when some players sit out, the game length is chosen so everyone gets
 * the same number of games (the table ranks by total points), at least 5
 * rounds and 3 games each, and as many points played per player as possible — e.g. 12 players on
 * 2 courts in 90 min → 18-point games, 6 rounds, 4 games each. If no length
 * fits exactly, one round short of what fits is allowed (stopAfter); failing
 * that, games can't come out even. When nobody sits, the highest points that
 * still fit 6+ rounds (6 rounds ≈ everyone meets most of the group): 90 min →
 * 16 points, 2 hours → 24.
 */
export function recommendSetup(
  players: number,
  courtsAvailable: number,
  durationMin: number | null | undefined,
  priority: Priority = "playing",
): Recommendation | null {
  if (players < 4) return null;
  const maxCourts = Math.max(1, Math.min(courtsAvailable, Math.floor(players / 4)));
  let courts = maxCourts;
  if (priority === "social") {
    let best = Infinity;
    for (let c = maxCourts; c >= 1; c--) {
      const share = (players - c * 4) / players;
      if (share > 0.4) continue;
      const score = Math.abs(share - 0.3);
      if (score <= best) {
        best = score;
        courts = c;
      }
    }
  }
  const options = [24, 21, 16, 12];
  const fits = (p: number, n: number) => (estimateRounds(durationMin, p) ?? 0) >= n;
  const points = !durationMin ? 24 : (options.find((p) => fits(p, 6)) ?? 12);
  const rounds = estimateRounds(durationMin, points);
  const fallback = (equalGames: boolean): Recommendation => ({
    courts,
    points,
    rounds,
    equalGames,
    gamesEach: equalGames && rounds != null ? rounds : null,
    stopAfter: null,
  });
  if (!durationMin) return fallback(players === courts * 4);
  if (players === courts * 4) return fallback(true); // nobody sits: games are always equal

  const equalAt = (p: number, r: number) => {
    if (r < 5) return null;
    const split = rosterSplit(players, courts, r);
    return split.playMin === split.playMax && split.playMin >= 3 ? { points: p, rounds: r, games: split.playMin } : null;
  };
  const best = (stopEarly: boolean) => {
    let pick: { points: number; rounds: number; games: number } | null = null;
    for (const p of POINT_OPTIONS) {
      const fit = estimateRounds(durationMin, p) ?? 0;
      const option = equalAt(p, stopEarly ? fit - 1 : fit);
      if (option && (!pick || option.games * option.points > pick.games * pick.points)) pick = option;
    }
    return pick;
  };
  const exact = best(false);
  const early = exact ? null : best(true);
  const pick = exact ?? early;
  if (!pick) return fallback(false);
  return {
    courts,
    points: pick.points,
    rounds: pick.rounds,
    equalGames: true,
    gamesEach: pick.games,
    stopAfter: early ? pick.rounds : null,
  };
}

/**
 * Roster sizes to steer away from. splitGroups: exactly half sit each round, so
 * the rotation alternates two fixed groups who never play each other (16 on 2
 * courts). longWaits: more than half sit, so people sit 2–3 rounds in a row.
 */
export function rosterWarnings(players: number, courts: number): { splitGroups: boolean; longWaits: boolean } {
  const onCourt = Math.max(0, Math.min(courts, Math.floor(players / 4))) * 4;
  const sitting = players - onCourt;
  return { splitGroups: onCourt > 0 && sitting === onCourt, longWaits: onCourt > 0 && sitting > onCourt };
}

export interface RosterSplit {
  /** Courts actually in use (a group too small for every booked court leaves some empty). */
  courtsUsed: number;
  sittingPerRound: number;
  /** Fewest / most rounds any one player sits out over the night. */
  sitMin: number;
  sitMax: number;
  /** Fewest / most games any one player gets. */
  playMin: number;
  playMax: number;
}

/**
 * Exact games and sit-outs per player for a roster, courts and number of
 * rounds. The bye rotation (pickByes) keeps everyone's sit-out count within
 * one of each other, so the night's sit-out slots split into floor/ceil shares.
 */
export function rosterSplit(players: number, courts: number, rounds: number): RosterSplit {
  const courtsUsed = Math.max(0, Math.min(courts, Math.floor(players / 4)));
  const sittingPerRound = Math.max(0, players - courtsUsed * 4);
  const slots = rounds * sittingPerRound;
  const sitMin = players > 0 ? Math.floor(slots / players) : 0;
  const sitMax = players > 0 ? Math.ceil(slots / players) : 0;
  return { courtsUsed, sittingPerRound, sitMin, sitMax, playMin: rounds - sitMax, playMax: rounds - sitMin };
}

/**
 * Roster size that balances play and rest: a few sitting each round, everyone
 * on court at least ~57% of the time, short of the split-in-half point. From
 * simulated nights, 10–14 suits 2 courts; 3 courts → 14–21.
 */
export function sweetSpot(courts: number): { min: number; max: number } {
  const onCourt = courts * 4;
  return { min: onCourt + 2, max: Math.floor((onCourt * 7) / 4) };
}

/** Rounds that fit in the booked court time (at least 1 when a duration is set). */
export function estimateRounds(durationMin: number | null | undefined, pointsPerMatch: number): number | null {
  if (!durationMin || durationMin <= 0) return null;
  return Math.max(1, Math.floor(Math.max(durationMin - SETUP_MINUTES, 0) / minutesPerMatch(pointsPerMatch)));
}
