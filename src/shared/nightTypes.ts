import type { FormatKey } from "./types";

// Night types: what kind of night the organizer is running. Each one is a
// bundle of the session's switches — the format (how courts are dealt), the
// beginner court and competitive sit-outs — so the form asks one question
// instead of six. The switches stay available under "Fine-tune"; a session
// whose switches match no type reads as "Custom".

// Each name leads with the padel format it runs on, so the organizer sees
// "Americano" or "Mexicano" without opening Fine-tune.
export type NightTypeKey = "social" | "open" | "tournament";

export interface NightTypeFlags {
  format: FormatKey;
  beginnerCourt: boolean;
  competitiveSitouts: boolean;
}

export interface NightType extends NightTypeFlags {
  key: NightTypeKey;
  name: string;
  emoji: string;
  tagline: string;
  /** One line for the picker. */
  blurb: string;
  /** What to print on the flyer / sign-up page. */
  flyer: string;
}

export const NIGHT_TYPES: Record<NightTypeKey, NightType> = {
  social: {
    key: "social",
    name: "Americano / Social",
    emoji: "🎉",
    tagline: "Everyone mixes",
    blurb: "New partner every round, courts drawn for variety, equal games for all. For a room that's roughly even.",
    flyer: "All levels welcome.",
    format: "americano",
    beginnerCourt: false,
    competitiveSitouts: false,
  },
  open: {
    key: "open",
    name: "Mexicano / Open night",
    emoji: "🌱",
    tagline: "Mixed room, beginner court",
    blurb: "Winners play winners on the ladder; the newbies you tag get the first court to themselves. For a few strong players and a lot of beginners.",
    flyer: "Ladder play plus a beginner court — limited newbie spots.",
    format: "mexicano",
    beginnerCourt: true,
    competitiveSitouts: false,
  },
  tournament: {
    key: "tournament",
    name: "Mexicano / Tournament",
    emoji: "🏁",
    tagline: "Earn your court time",
    blurb: "The ladder deals the courts and, after three games each, the bottom of the table sits out. Beginner court too if newbies show.",
    flyer: "Competitive night — after three games, the table decides who plays.",
    format: "mexicano",
    beginnerCourt: true,
    competitiveSitouts: true,
  },
};

export const NIGHT_TYPE_KEYS: NightTypeKey[] = ["social", "open", "tournament"];

/** The night type these switches amount to, or null when they match none ("Custom"). */
export function nightTypeOf(flags: NightTypeFlags): NightTypeKey | null {
  return (
    NIGHT_TYPE_KEYS.find((k) => {
      const t = NIGHT_TYPES[k];
      return t.format === flags.format && t.beginnerCourt === flags.beginnerCourt && t.competitiveSitouts === flags.competitiveSitouts;
    }) ?? null
  );
}

/** The switches a night type sets. */
export function flagsOf(key: NightTypeKey): NightTypeFlags {
  const { format, beginnerCourt, competitiveSitouts } = NIGHT_TYPES[key];
  return { format, beginnerCourt, competitiveSitouts };
}
