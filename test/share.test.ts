import { describe, expect, it } from "vitest";
import { resultsText } from "../src/shared/share";
import type { StandingRow } from "../src/shared/types";

const row = (name: string, points: number, played: number, ranked = true): StandingRow => ({
  playerId: name,
  name,
  points,
  against: 0,
  diff: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  played,
  byes: 0,
  ranked,
});

describe("share results", () => {
  it("podium, everyone's place and points, then the link", () => {
    const text = resultsText(
      {
        name: "Wednesday Padel",
        standings: [row("Dani", 33, 4), row("Shani", 32, 4), row("Aryeh", 32, 4), row("Didi", 22, 4), row("Elise", 6, 1, false), row("Zed", 0, 0, false)],
      },
      "https://padeltime.andrewabony.com/board/ABC123",
    );
    expect(text).toBe(
      [
        "🏆 Wednesday Padel — final results",
        "🥇 Dani 33 · 🥈 Shani 32 · 🥉 Aryeh 32",
        "",
        "1. Dani 33",
        "2. Shani 32",
        "3. Aryeh 32",
        "4. Didi 22",
        "– Elise 6 (too few games)",
        "",
        "Full results: https://padeltime.andrewabony.com/board/ABC123",
      ].join("\n"),
    );
  });

  it("copes with a night of fewer than three ranked players", () => {
    const text = resultsText({ name: "Tiny", standings: [row("A", 10, 1)] }, "u");
    expect(text.split("\n").slice(0, 3)).toEqual(["🏆 Tiny — final results", "🥇 A 10", ""]);
  });
});
