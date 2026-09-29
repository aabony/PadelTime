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
}

export type Priority = "playing" | "social";

/**
 * What to run. Playing: every court you can fill. Social: courts chosen so
 * roughly 30% of the group sits each round (never more than 40%) — a sit-out
 * lasts one round, so shorter games keep those breaks short. Either way the
 * points are the highest that still fit 6+ rounds in the booking (6 rounds ≈
 * everyone meets most of the group): 90 min → 16 points, 2 hours → 24.
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
  return { courts, points, rounds: estimateRounds(durationMin, points) };
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

/** Roster size that keeps everyone on court for 60–100% of rounds: 3 courts → 12–20 players. */
export function sweetSpot(courts: number): { min: number; max: number } {
  return { min: courts * 4, max: Math.floor((courts * 4) / 0.6) };
}

/** Rounds that fit in the booked court time (at least 1 when a duration is set). */
export function estimateRounds(durationMin: number | null | undefined, pointsPerMatch: number): number | null {
  if (!durationMin || durationMin <= 0) return null;
  return Math.max(1, Math.floor(Math.max(durationMin - SETUP_MINUTES, 0) / minutesPerMatch(pointsPerMatch)));
}
