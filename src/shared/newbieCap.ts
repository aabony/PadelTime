// The newbie cap: one beginner court plays four at a time, so a night with too
// many newbies leaves them standing around. With a cap, a Newbie who signs up
// after the spots are gone goes on the waitlist. The organizer can still add or
// tag anyone — the cap is for sign-ups, not for the person running the night.

/** A stored or submitted cap: a whole number of newbies, or null for no limit. */
export function normalizeNewbieCap(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), 64);
}

type RosterEntry = { status: string; newbie?: boolean | number | null };

/** Newbies who have a place tonight (signed up or here — not waitlisted, not dropped). */
export function newbiesIn(players: RosterEntry[]): number {
  return players.filter((p) => !!p.newbie && (p.status === "confirmed" || p.status === "checked_in")).length;
}

/** Newbie places still open; null when the night has no cap (or no beginner court). */
export function newbieSpotsLeft(
  session: { beginnerCourt: boolean; fixedTeams: boolean; maxNewbies: number | null | undefined },
  players: RosterEntry[],
): number | null {
  const cap = session.beginnerCourt && !session.fixedTeams ? normalizeNewbieCap(session.maxNewbies) : null;
  return cap == null ? null : Math.max(0, cap - newbiesIn(players));
}

/**
 * Who comes off the waitlist when places open: oldest sign-ups first, a newbie
 * only while a newbie place is open (they're skipped, not blocking the queue).
 */
export function promotable<T extends RosterEntry & { joinedAt: number }>(
  players: T[],
  maxPlayers: number,
  newbieSpots: number | null,
): T[] {
  let spots = maxPlayers - players.filter((p) => p.status === "confirmed" || p.status === "checked_in").length;
  let newbies = newbieSpots ?? Infinity;
  const out: T[] = [];
  for (const p of players.filter((x) => x.status === "waitlist").sort((a, b) => a.joinedAt - b.joinedAt)) {
    if (spots <= 0) break;
    if (p.newbie) {
      if (newbies <= 0) continue;
      newbies--;
    }
    out.push(p);
    spots--;
  }
  return out;
}
