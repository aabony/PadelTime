import type { MatchRow, RoundRow, StandingRow } from "./types";
import { pairKey } from "./formats/types";

// Individual standings from confirmed matches only. Every player on a team is
// credited with the team's points (Americano rule). The table ranks by total
// points — but you need at least half as many games as the busiest player to be
// ranked; anyone with fewer (left early, arrived very late) keeps their scores,
// listed below.

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
  return rankRows([...byId.values()]);
}

/** Fills in difference and ranked, then sorts: ranked first, then points, wins, difference, name. */
function rankRows(rows: StandingRow[]): StandingRow[] {
  const min = minGamesToRank(rows);
  for (const r of rows) {
    r.diff = r.points - r.against;
    r.ranked = r.played > 0 && r.played >= min;
  }
  return rows.sort(
    (a, b) =>
      Number(b.ranked) - Number(a.ranked) ||
      b.points - a.points ||
      b.wins - a.wins ||
      b.diff - a.diff ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Standings by team when the session keeps teams together: one row per pair
 * that has played (keyed by pairKey, named "Ana & Ben"), plus current pairs
 * who are both checked in but haven't played yet. A player who was re-paired
 * mid-night appears in each team
 * they played in, with that team's results.
 */
export function computeTeamStandings(
  players: { id: string; name: string; partnerId?: string | null; status?: string }[],
  rounds: RoundRow[],
): StandingRow[] {
  const order = new Map(players.map((p, i) => [p.id, i]));
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const byKey = new Map<string, StandingRow>();
  const team = (x: string, y: string): StandingRow => {
    const key = pairKey(x, y);
    let row = byKey.get(key);
    if (!row) {
      // Roster order (who joined first) decides which name comes first.
      const members = [x, y].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      row = {
        playerId: key,
        name: members.map((m) => nameOf.get(m) ?? "?").join(" & "),
        points: 0,
        against: 0,
        diff: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        played: 0,
        byes: 0,
        ranked: false,
        members,
      };
      byKey.set(key, row);
    }
    return row;
  };
  // Current pairs who are both here show up before their first game; pairs who
  // never made it onto a court (no-shows, the waitlist) stay off the table.
  const here = (p: { status?: string }) => (p.status ?? "checked_in") === "checked_in";
  for (const p of players) {
    const partner = p.partnerId ? players.find((q) => q.id === p.partnerId) : undefined;
    if (partner && partner.partnerId === p.id && here(p) && here(partner)) team(p.id, partner.id);
  }
  // Every team that has played, before counting, so early sit-outs land on teams first seen later.
  for (const round of rounds) for (const m of round.matches) if (m.status === "confirmed") team(m.a[0], m.a[1]), team(m.b[0], m.b[1]);
  for (const round of rounds) {
    const sat = new Set(round.byes);
    for (const row of byKey.values()) if (row.members!.every((m) => sat.has(m))) row.byes += 1;
    for (const m of round.matches) {
      if (m.status !== "confirmed" || m.scoreA == null || m.scoreB == null) continue;
      for (const [ids, sf, sa] of [
        [m.a, m.scoreA, m.scoreB],
        [m.b, m.scoreB, m.scoreA],
      ] as const) {
        const row = team(ids[0], ids[1]);
        row.points += sf;
        row.against += sa;
        row.played += 1;
        if (sf > sa) row.wins += 1;
        else if (sf < sa) row.losses += 1;
        else row.ties += 1;
      }
    }
  }
  return rankRows([...byKey.values()]);
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
