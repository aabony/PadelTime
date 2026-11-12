// Player ability: players rate themselves (on their profile, and per night on
// the join page), the organizer can set or override it in the roster. Private —
// a player only ever sees their own. Four coarse levels on purpose.
//
// What the level does:
// - "Group players by playing level": newbies and beginners together,
//   intermediate and advanced together — every round in Casual (Americano,
//   which also balances teams by level), for each player's first two games in
//   Competitive (Mexicano). Newbie and Beginner are the same side of that line.
// - Newbie: a player who joins a night as a Newbie arrives already tagged for
//   the beginner court (the organizer can untag them; see `newbie` on the roster).
export interface LevelMeta {
  value: number;
  label: string;
  short: string;
  emoji: string;
  /** What a player at this level would say about themselves — shown beside the level so they pick the right one. */
  blurb: string;
}

export const NEWBIE = 1;
export const BEGINNER = 2;
export const ADVANCED = 4;

export const LEVELS: LevelMeta[] = [
  { value: NEWBIE, label: "Newbie", short: "New", emoji: "🐣", blurb: "New to padel. I've never played, or played 5 times or fewer." },
  { value: BEGINNER, label: "Beginner", short: "Beg", emoji: "🌱", blurb: "I've played more than 5 times, know the rules and can play off the glass." },
  { value: 3, label: "Intermediate", short: "Int", emoji: "💪", blurb: "I'm 1.5 or higher on Playtomic, have played competitive games and taken lessons." },
  { value: ADVANCED, label: "Advanced", short: "Adv", emoji: "🔥", blurb: "I compete regularly and play at a high level." },
];

/** Level used in calculations when a player hasn't been given one: Intermediate. */
export const UNSET_LEVEL = 3;

/** A stored value on the four-level scale; null when unset or invalid. */
export function normalizeLevel(v: number | null | undefined): number | null {
  if (v == null || !Number.isInteger(v)) return null;
  return v >= NEWBIE && v <= ADVANCED ? v : null;
}

export function levelMeta(value: number | null | undefined): LevelMeta | null {
  const n = normalizeLevel(value);
  return LEVELS.find((l) => l.value === n) ?? null;
}

/** Clamp anything from the wire to a valid level, or null. */
export function parseLevel(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return normalizeLevel(n);
}

/** The beginner side of the level line: Newbie or Beginner. */
export function isBeginner(level: number | null | undefined): boolean {
  const n = normalizeLevel(level);
  return n != null && n <= BEGINNER;
}

export function isNewbie(level: number | null | undefined): boolean {
  return normalizeLevel(level) === NEWBIE;
}
