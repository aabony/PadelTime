import type { MatchRow, RoundRow, StandingRow } from "./types";

// Individual standings from confirmed matches only. Every player on a team is
// credited with the team's points (Americano rule). The table ranks by points
// per game, so sitting out (or arriving late) never costs you — but you need at
// least half as many games as the busiest player to be ranked; anyone with
// fewer (left early, arrived very late) keeps their scores, listed below.

/** Points per game played; -1 for someone who hasn't played. */
export function pointsPerGame(row: { points: number; played: number }): number {
  return row.played > 0 ? row.points / row.played : -1;
}

/** Fewest games needed to be ranked: half the most anyone has played, rounded up. */
export function minGamesToRank(rows: { played: number }[]): number {
  return Math.ceil(Math.max(0, ...rows.map((r) => r.played)) / 2);
}

export function computeStandings(
  players: { id: string; name: string }[],
  rounds: RoundRow[],
): StandingRow[] {
  const byId = new Map<string, StandingRow>();
  for (const p of players) {
    byId.set(p.id, {
      playerId: p.id,
      name: p.name,
      points: 0,
      against: 0,
      diff: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      played: 0,
      byes: 0,
      ranked: false,
    });
  }
  const credit = (ids: [string, string], scoreFor: number, scoreAgainst: number) => {
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      row.points += scoreFor;
      row.against += scoreAgainst;
      row.played += 1;
      if (scoreFor > scoreAgainst) row.wins += 1;
      else if (scoreFor < scoreAgainst) row.losses += 1;
      else row.ties += 1;
    }
  };
  for (const round of rounds) {
    for (const id of round.byes) {
      const row = byId.get(id);
      if (row) row.byes += 1;
    }
    for (const m of round.matches) {
      if (m.status !== "confirmed" || m.scoreA == null || m.scoreB == null) continue;
      credit(m.a, m.scoreA, m.scoreB);
      credit(m.b, m.scoreB, m.scoreA);
    }
  }
  const rows = [...byId.values()];
  const min = minGamesToRank(rows);
  for (const r of rows) {
    r.diff = r.points - r.against;
    r.ranked = r.played > 0 && r.played >= min;
  }
  rows.sort(
    (a, b) =>
      Number(b.ranked) - Number(a.ranked) ||
      pointsPerGame(b) - pointsPerGame(a) ||
      b.points - a.points ||
      b.wins - a.wins ||
      b.diff - a.diff ||
      a.name.localeCompare(b.name),
  );
  return rows;
}

/**
 * Court-assignment order for ranked formats (Mexicano): points per match played
 * first, so sitting a round out never drops you a court; then total points,
 * then point difference. Unlike the table, nobody is left unranked here.
 */
export function rankForCourts<T extends { points: number; diff: number; played: number; name: string }>(rows: T[]): T[] {
  const avg = (r: T) => (r.played > 0 ? r.points / r.played : -1);
  return [...rows].sort(
    (a, b) => avg(b) - avg(a) || b.points - a.points || b.diff - a.diff || a.name.localeCompare(b.name),
  );
}

export function matchComplete(m: MatchRow): boolean {
  return m.status === "confirmed";
}
