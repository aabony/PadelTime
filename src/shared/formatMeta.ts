import type { FormatKey } from "./types";

// How each format is presented: the organizer picks a *style* (casual /
// competitive); the format name is the padel-world term behind it.
export interface FormatMeta {
  key: FormatKey;
  name: string;
  style: string;
  emoji: string;
  tagline: string;
  blurb: string;
  /** The blurb when the session groups players by playing level. */
  groupedBlurb: string;
  /** The blurb when the session keeps teams together. */
  teamsBlurb: string;
}

export const FORMAT_META: Record<FormatKey, FormatMeta> = {
  americano: {
    key: "americano",
    name: "Americano",
    style: "Casual",
    emoji: "🎉",
    tagline: "Mix with everyone",
    blurb: "New partner every round and courts drawn for variety — it's you against the whole field.",
    groupedBlurb:
      "New partner every round, courts filled by playing level — beginners play beginners, intermediate and advanced play each other.",
    teamsBlurb: "Same partner all night — your team meets a different team every round.",
  },
  mexicano: {
    key: "mexicano",
    name: "Mexicano",
    style: "Competitive",
    emoji: "🏆",
    tagline: "Play your level",
    blurb:
      "Round 1 is a random draw. After that the standings deal the courts: top four on court 1, next four on court 2… 1st & 4th vs 2nd & 3rd, so every match stays close.",
    groupedBlurb:
      "Each player's first two games are grouped by playing level. After that the standings deal the courts: top four on court 1, next four on court 2… 1st & 4th vs 2nd & 3rd, so every match stays close.",
    teamsBlurb:
      "Same partner all night. After each round the standings deal the courts: top two teams on court 1, the next two on court 2… winners play winners.",
  },
};

export const FORMAT_KEYS: FormatKey[] = ["americano", "mexicano"];

export function formatMeta(key: string): FormatMeta {
  return FORMAT_META[key as FormatKey] ?? FORMAT_META.americano;
}

/** How a format plays with the session's switches. */
export function blurbFor(key: string, s: { groupByLevel?: boolean; fixedTeams?: boolean }): string {
  const m = formatMeta(key);
  return s.fixedTeams ? m.teamsBlurb : s.groupByLevel ? m.groupedBlurb : m.blurb;
}
