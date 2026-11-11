import { BEGINNER_COURT, poolOfMatch } from "./formats/pools";
import type { Nudge, RoundRow } from "./types";

// Move up / move down are the organizer's taps. These are the hints next to
// them: a newbie on a winning streak on the beginner court, a ladder player who
// hasn't won anything. Nothing here moves anyone.

export type { Nudge };

/** Straight wins on the beginner court that suggest a move up. */
export const UP_STREAK = 3;
/** Ladder games without a win that suggest a move down. */
export const DOWN_AFTER = 3;

export function computeNudges(
  players: { id: string; status: string; newbie?: boolean }[],
  rounds: RoundRow[],
  beginnerCourt = BEGINNER_COURT,
): Nudge[] {
  const results = new Map<string, { pool: "beginner" | "ladder"; won: boolean }[]>();
  for (const r of rounds) {
    for (const m of r.matches) {
      if (m.status !== "confirmed" || m.scoreA == null || m.scoreB == null) continue;
      const pool = poolOfMatch(r, m, beginnerCourt);
      for (const id of m.a) results.set(id, [...(results.get(id) ?? []), { pool, won: m.scoreA > m.scoreB }]);
      for (const id of m.b) results.set(id, [...(results.get(id) ?? []), { pool, won: m.scoreB > m.scoreA }]);
    }
  }
  const out: Nudge[] = [];
  for (const p of players) {
    if (p.status !== "checked_in") continue;
    const mine = results.get(p.id) ?? [];
    if (p.newbie) {
      const onCourt1 = mine.filter((x) => x.pool === "beginner");
      const streak = onCourt1.slice(-UP_STREAK);
      if (streak.length >= UP_STREAK && streak.every((x) => x.won)) {
        out.push({ playerId: p.id, kind: "up", reason: `${streak.length} straight wins on the beginner court` });
      }
    } else {
      const inLadder = mine.filter((x) => x.pool === "ladder");
      if (inLadder.length >= DOWN_AFTER && inLadder.every((x) => !x.won)) {
        out.push({ playerId: p.id, kind: "down", reason: `0 wins after ${inLadder.length} ladder games` });
      }
    }
  }
  return out;
}
