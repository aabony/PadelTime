// Stand-in players for a dry run: one tap fills a roster with a believable mix
// of genders and levels, so the organizer can deal rounds, enter scores and try
// the beginner court without real people. They're roster guests, not accounts:
// nobody is emailed, and they never appear on the members list.

export interface TestPlayer {
  name: string;
  gender: "woman" | "man";
  /** 1 newbie, 2 beginner, 3 intermediate, 4 advanced. */
  level: number;
}

/** Marks a roster name as a stand-in ("Test-Jessica"); a real player joining is never matched to one. */
export const TEST_PREFIX = "Test-";

export function isTestPlayerName(name: string | null | undefined): boolean {
  return !!name && name.trim().toLowerCase().startsWith(TEST_PREFIX.toLowerCase());
}

const p = (name: string, gender: TestPlayer["gender"], level: number): TestPlayer => ({ name: TEST_PREFIX + name, gender, level });

/**
 * Sixteen, ordered so any first N are balanced: women and men alternate, and
 * every four hold one of each level. The first 12 are 6 women + 6 men with 3
 * newbies, 3 beginners, 3 intermediate and 3 advanced.
 */
export const TEST_PLAYERS: TestPlayer[] = [
  p("Jessica", "woman", 3),
  p("Adam", "man", 4),
  p("Sarah", "woman", 2),
  p("Mike", "man", 1),
  p("Emily", "woman", 4),
  p("Chris", "man", 3),
  p("Ashley", "woman", 1),
  p("Josh", "man", 2),
  p("Megan", "woman", 3),
  p("Ryan", "man", 4),
  p("Lauren", "woman", 2),
  p("Matt", "man", 1),
  p("Rachel", "woman", 4),
  p("Kevin", "man", 3),
  p("Amanda", "woman", 1),
  p("Brian", "man", 2),
];

/** How many one tap adds. */
export const TEST_BATCH = 12;

/** The next stand-ins to add: those not on the roster yet, in order, up to `count`. */
export function nextTestPlayers(onRoster: (string | null | undefined)[], count = TEST_BATCH): TestPlayer[] {
  const taken = new Set(onRoster.filter(Boolean).map((n) => n!.trim().toLowerCase()));
  return TEST_PLAYERS.filter((t) => !taken.has(t.name.toLowerCase())).slice(0, Math.max(0, count));
}
