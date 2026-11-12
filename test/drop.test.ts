import { describe, expect, it } from "vitest";
import { DEFAULT_DROP_AFTER, averageResult, belowTheCut, dropCountdown, dropOn, normalizeDropAfter } from "../src/shared/drop";

describe("the drop round", () => {
  it("rounds up to the drop round are fair; the next one is the first decided by the table", () => {
    expect([1, 2, 3, 4, 5].map((n) => dropOn(3, n))).toEqual([false, false, false, true, true]);
  });

  it("reads a stored or submitted round, falling back to the default", () => {
    expect(DEFAULT_DROP_AFTER).toBe(3);
    expect(normalizeDropAfter(4)).toBe(4);
    expect(normalizeDropAfter("5")).toBe(5);
    expect(normalizeDropAfter(null)).toBe(3);
    expect(normalizeDropAfter("")).toBe(3);
    expect(normalizeDropAfter("soon")).toBe(3);
    expect(normalizeDropAfter(0)).toBe(1);
    expect(normalizeDropAfter(999)).toBe(30);
  });
});

describe("the countdown", () => {
  it("counts the fair rounds left, the one being played included", () => {
    expect(dropCountdown(3, 1)).toEqual({ state: "counting", afterRound: 3, roundsLeft: 3, done: 0 });
    expect(dropCountdown(3, 2)).toEqual({ state: "counting", afterRound: 3, roundsLeft: 2, done: 1 });
  });

  it("calls the last fair round, then the drop", () => {
    expect(dropCountdown(3, 3)).toEqual({ state: "last", afterRound: 3, roundsLeft: 1, done: 2 });
    expect(dropCountdown(3, 4)).toEqual({ state: "on", afterRound: 3, roundsLeft: 0, done: 3 });
    expect(dropCountdown(3, 9).state).toBe("on");
  });

  it("before round 1 reads as round 1", () => {
    expect(dropCountdown(4, 0)).toEqual(dropCountdown(4, 1));
  });
});

describe("below the cut", () => {
  const row = (playerId: string, points: number, played: number, diff = 0) => ({ playerId, points, played, diff });
  // Points per game: a 12, b 10, c 8, d 6, e 4, f 2.
  const table = [row("a", 24, 2), row("b", 20, 2), row("c", 8, 1), row("d", 12, 2), row("e", 4, 1), row("f", 4, 2)];
  const ids = ["a", "b", "c", "d", "e", "f"];
  const sorted = (s: Set<string>) => [...s].sort();

  it("marks the lowest points per game — not the lowest totals", () => {
    // c has fewer points than d but the better average, so d is the one below the cut.
    expect(sorted(belowTheCut(table, ids, 3))).toEqual(["d", "e", "f"]);
    expect(sorted(belowTheCut(table, ids, 2))).toEqual(["e", "f"]);
  });

  it("marks nobody when everyone plays", () => {
    expect(belowTheCut(table, ids, 0).size).toBe(0);
  });

  it("only counts players in the draw", () => {
    // f has gone home: with one sitting, e is now the lowest.
    expect(sorted(belowTheCut(table, ["a", "b", "c", "d", "e"], 1))).toEqual(["e"]);
  });

  it("a late arrival never dealt a game takes a place: one more of the table goes below the cut", () => {
    expect(sorted(belowTheCut(table, [...ids, "late"], 4, { owedAGame: ["late"] }))).toEqual(["c", "d", "e", "f"]);
  });

  it("someone in their first game counts as average: not dropped first, not handed a place, never marked", () => {
    // "new" is on court now (dealt, no result). The table averages 7 a game, so they rank between d (6) and c (8).
    expect(averageResult(table)).toBe(7);
    expect(sorted(belowTheCut(table, [...ids, "new"], 3))).toEqual(["d", "e", "f"]);
    // One more sits: that's "new", who isn't marked — there's no result to judge.
    expect(sorted(belowTheCut(table, [...ids, "new"], 4))).toEqual(["d", "e", "f"]);
    expect(sorted(belowTheCut(table, [...ids, "new"], 5))).toEqual(["c", "d", "e", "f"]);
  });

  it("finals: no grace — anyone without a result is out with the rest", () => {
    expect(sorted(belowTheCut(table, [...ids, "late"], 4, { finals: true, owedAGame: ["late"] }))).toEqual(["d", "e", "f", "late"]);
  });
});
