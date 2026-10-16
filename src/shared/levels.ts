// Player ability, set by the organizer in the roster and never shown to
// players. Three coarse levels on purpose. Only used when the session has
// "Group players by playing level" on: beginners together, intermediate and
// advanced together — every round in Casual (Americano, which also balances
// teams by level), for each player's first two games in Competitive (Mexicano).
//
// Stored values reuse the earlier 1–4 scale so rows saved by the old feature
// still read sensibly: 1 ("Newbie") now reads as Beginner.
export interface LevelMeta {
  value: number;
  label: string;
  short: string;
  emoji: string;
}

export const LEVELS: LevelMeta[] = [
  { value: 2, label: "Beginner", short: "Beg", emoji: "🌱" },
  { value: 3, label: "Intermediate", short: "Int", emoji: "💪" },
  { value: 4, label: "Advanced", short: "Adv", emoji: "🔥" },
];

export const BEGINNER = 2;
export const ADVANCED = 4;

/** Level used in calculations when a player hasn't been given one: Intermediate. */
export const UNSET_LEVEL = 3;

/** Map a stored value onto the three-level scale (old 1 → Beginner); null when unset or invalid. */
export function normalizeLevel(v: number | null | undefined): number | null {
  if (v == null || !Number.isInteger(v)) return null;
  if (v === 1) return BEGINNER;
  return v >= BEGINNER && v <= ADVANCED ? v : null;
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

export function isBeginner(level: number | null | undefined): boolean {
  return normalizeLevel(level) === BEGINNER;
}
