// The format engine contract.
//
// One session engine, many format strategies (architecture plan §5).
// Every format answers the same questions — how teams are made, how courts are
// assigned, how byes rotate — by implementing `planRound` against the same
// EngineContext. Americano is the first strategy; Mexicano / King of the Court
// plug in later without touching the session engine.

export interface EngineContext {
  /** Eligible session_player ids (checked in, not dropped). */
  players: string[];
  /** Physical courts available. */
  courts: number;
  /** 1-based number of the round being generated. */
  roundNumber: number;
  /** Times each exact pair has partnered. Key: pairKey(a, b). */
  partnerCounts: Record<string, number>;
  /** Times each exact pair has opposed. Key: pairKey(a, b). */
  opponentCounts: Record<string, number>;
  /** Matches played per player id. */
  playedCounts: Record<string, number>;
  /** Byes per player id. */
  byeCounts: Record<string, number>;
  /** Round number of each player's most recent bye (0 = never). */
  lastByeRound: Record<string, number>;
  /**
   * Court-assignment order for ranked formats like Mexicano: players with results,
   * best first (points per match played, then total points, then difference).
   * Empty until a match has been confirmed.
   */
  standings: { playerId: string; points: number; diff?: number; played?: number }[];
  /** Organizer-set level per player id (2 beginner, 3 intermediate, 4 advanced); unset players are omitted. */
  levels?: Record<string, number>;
  /** "Group players by playing level": beginners play beginners, intermediate/advanced play each other. */
  groupByLevel?: boolean;
  /** Gender per player id ("woman" | "man"); players who haven't said are omitted. */
  genders?: Record<string, "woman" | "man">;
  /** Prefer teams of one woman + one man whenever the numbers allow. */
  mixedPairs?: boolean;
  /** Random source, injectable for deterministic tests. */
  rng: () => number;
}

export interface PlannedMatch {
  court: number;
  a: [string, string];
  b: [string, string];
}

export interface RoundPlan {
  matches: PlannedMatch[];
  byes: string[];
}

export interface FormatStrategy {
  key: string;
  name: string;
  minPlayers: number;
  defaultPoints: number;
  planRound(ctx: EngineContext): RoundPlan;
}

/** Canonical unordered pair key. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Deterministic PRNG for tests and reproducible planning. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
