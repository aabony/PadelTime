import { pairKey } from "./formats/types";

export interface HistoryRound {
  number: number;
  byes: string[];
  matches: { a: [string, string]; b: [string, string] }[];
}

export interface History {
  partnerCounts: Record<string, number>;
  opponentCounts: Record<string, number>;
  playedCounts: Record<string, number>;
  byeCounts: Record<string, number>;
  lastByeRound: Record<string, number>;
  /** Who was on court in each round, oldest first. */
  courtRounds: string[][];
}

/** Aggregate partner/opponent/bye history from played rounds (scored or not —
 *  a scheduled pairing counts against diversity either way). */
export function buildHistory(rounds: HistoryRound[]): History {
  const h: History = {
    partnerCounts: {},
    opponentCounts: {},
    playedCounts: {},
    byeCounts: {},
    lastByeRound: {},
    courtRounds: [],
  };
  const bump = (rec: Record<string, number>, key: string, by = 1) => {
    rec[key] = (rec[key] ?? 0) + by;
  };
  for (const round of rounds) {
    for (const p of round.byes) {
      bump(h.byeCounts, p);
      h.lastByeRound[p] = Math.max(h.lastByeRound[p] ?? 0, round.number);
    }
    for (const m of round.matches) {
      bump(h.partnerCounts, pairKey(m.a[0], m.a[1]));
      bump(h.partnerCounts, pairKey(m.b[0], m.b[1]));
      for (const x of m.a) for (const y of m.b) bump(h.opponentCounts, pairKey(x, y));
      for (const p of [...m.a, ...m.b]) bump(h.playedCounts, p);
    }
    h.courtRounds.push(round.matches.flatMap((m) => [...m.a, ...m.b]));
  }
  return h;
}

/**
 * Rounds a player missed (arrived late, or wasn't checked in) count as their
 * fair share of a sit-out: the fraction of the field that sat that round. A
 * latecomer then slots into the normal rotation instead of sitting out until
 * their sit-out count catches up with everyone else's. A night where everyone
 * was there from round 1 is unchanged.
 */
export function creditAbsences(h: History, rounds: HistoryRound[], players: string[]): History {
  const credit: Record<string, number> = {};
  for (const round of rounds) {
    const there = new Set([...round.byes, ...round.matches.flatMap((m) => [...m.a, ...m.b])]);
    if (there.size === 0) continue;
    const share = round.byes.length / there.size;
    for (const p of players) {
      if (there.has(p)) continue;
      credit[p] = (credit[p] ?? 0) + share;
      h.lastByeRound[p] = Math.max(h.lastByeRound[p] ?? 0, round.number);
    }
  }
  // Rounded once, after summing: 3 × (1/3) must compare equal to a real sit-out.
  for (const [p, c] of Object.entries(credit)) h.byeCounts[p] = Math.round(((h.byeCounts[p] ?? 0) + c) * 1e9) / 1e9;
  return h;
}
