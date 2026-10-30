import { describe, expect, it } from "vitest";
import { swapInRound, swapTeamsInRound } from "../src/shared/swap";
import type { SwapMatch } from "../src/shared/swap";

const court = (id: string, slots: string[], scored = false): SwapMatch => ({
  id,
  slots: slots as SwapMatch["slots"],
  scored,
});

describe("swapInRound", () => {
  const round = () => [court("m1", ["a", "b", "c", "d"]), court("m2", ["e", "f", "g", "h"])];

  it("brings in a sitting player; the one going out sits", () => {
    const r = swapInRound(round(), ["i", "j"], "b", "j");
    expect(r).toEqual({ matches: [court("m1", ["a", "j", "c", "d"])], byes: ["i", "b"] });
  });

  it("trades places with a player on another court", () => {
    const r = swapInRound(round(), ["i"], "a", "h");
    expect(r).toEqual({
      matches: [court("m1", ["h", "b", "c", "d"]), court("m2", ["e", "f", "g", "a"])],
      byes: ["i"],
    });
  });

  it("brings in a late arrival who isn't in the round", () => {
    const r = swapInRound(round(), [], "c", "z");
    expect(r).toEqual({ matches: [court("m1", ["a", "b", "z", "d"])], byes: ["c"] });
  });

  it("refuses scored games, same game and players not on court", () => {
    expect(swapInRound([court("m1", ["a", "b", "c", "d"], true)], ["i"], "a", "i")).toHaveProperty("error");
    expect(
      swapInRound([court("m1", ["a", "b", "c", "d"]), court("m2", ["e", "f", "g", "h"], true)], [], "a", "e"),
    ).toHaveProperty("error");
    expect(swapInRound(round(), ["i"], "a", "b")).toHaveProperty("error");
    expect(swapInRound(round(), ["i"], "i", "a")).toHaveProperty("error");
    expect(swapInRound(round(), ["i"], "a", "a")).toHaveProperty("error");
  });
});

describe("swapTeamsInRound", () => {
  const round = () => [court("m1", ["a", "b", "c", "d"]), court("m2", ["e", "f", "g", "h"])];

  it("brings a sitting team on; the team going off sits", () => {
    const r = swapTeamsInRound(round(), ["i", "j"], ["a", "b"], ["i", "j"]);
    expect(r).toEqual({ matches: [court("m1", ["i", "j", "c", "d"])], byes: ["a", "b"] });
  });

  it("trades two teams between courts", () => {
    const r = swapTeamsInRound(round(), [], ["c", "d"], ["e", "f"]);
    expect(r).toEqual({
      matches: [court("m1", ["a", "b", "e", "f"]), court("m2", ["c", "d", "g", "h"])],
      byes: [],
    });
  });

  it("brings in a team that just arrived", () => {
    const r = swapTeamsInRound(round(), [], ["g", "h"], ["x", "y"]);
    expect(r).toEqual({ matches: [court("m2", ["e", "f", "x", "y"])], byes: ["g", "h"] });
  });

  it("refuses a game with a score", () => {
    expect(swapTeamsInRound([court("m1", ["a", "b", "c", "d"], true)], ["i", "j"], ["a", "b"], ["i", "j"])).toHaveProperty("error");
  });
});
