// Players without an account: people the organizer added to a roster by name.
// Their games are on the board but belong to nobody, so they don't show in a
// member's stats. The admin can link them to a registered member afterwards.

/** One roster entry of a guest who played. */
export interface GuestEntry {
  playerId: string;
  name: string;
  sessionId: string;
  sessionName: string;
  /** When that tournament was created (ms). */
  sessionAt: number;
  /** Scored games in that tournament. */
  games: number;
}

/** A guest name with every tournament it appears in (the same name can be different people on different nights). */
export interface GuestGroup {
  key: string;
  name: string;
  entries: GuestEntry[];
  games: number;
  lastAt: number;
}

export interface GuestsResponse {
  guests: GuestEntry[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Entries grouped by name (ignoring case and spacing), most recently played first; within a name, newest tournament first. */
export function groupGuests(entries: GuestEntry[]): GuestGroup[] {
  const groups = new Map<string, GuestGroup>();
  for (const e of [...entries].sort((a, b) => b.sessionAt - a.sessionAt)) {
    const key = norm(e.name);
    const g = groups.get(key) ?? { key, name: e.name.trim(), entries: [], games: 0, lastAt: e.sessionAt };
    g.entries.push(e);
    g.games += e.games;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.lastAt - a.lastAt || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * The registered member a guest name most likely is: the full name, or a first
 * name with an optional last initial ("David G" → David Gordon). Only when
 * exactly one member fits — "Aaron" with two Aarons registered suggests nobody.
 */
export function suggestMember<M extends { name: string }>(guestName: string, members: M[]): M | null {
  const guest = norm(guestName).replace(/\./g, "");
  if (!guest) return null;
  const exact = members.filter((m) => norm(m.name) === guest);
  if (exact.length === 1) return exact[0];
  const [first, ...rest] = guest.split(" ");
  const last = rest.join(" ");
  const fits = members.filter((m) => {
    const [mFirst, ...mRest] = norm(m.name).split(" ");
    if (mFirst !== first) return false;
    return last === "" || mRest.join(" ").startsWith(last);
  });
  return fits.length === 1 ? fits[0] : null;
}
