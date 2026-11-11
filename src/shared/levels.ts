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
  /** One line a player reads to pick the right one. */
  blurb: string;
}

export const NEWBIE = 1;
export const BEGINNER = 2;
export const ADVANCED = 4;

export const LEVELS: LevelMeta[] = [
  { value: NEWBIE, label: "Newbie", short: "New", emoji: "🐣", blurb: "New to padel — never played, or just a couple of times." },
  { value: BEGINNER, label: "Beginner", short: "Beg", emoji: "🌱", blurb: "Know the rules and can keep a rally going." },
  { value: 3, label: "Intermediate", short: "Int", emoji: "💪", blurb: "Play regularly; comfortable with the walls and at the net." },
  { value: ADVANCED, label: "Advanced", short: "Adv", emoji: "🔥", blurb: "Compete, or have played for years." },
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
