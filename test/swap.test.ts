import { describe, expect, it } from "vitest";
import { pickReplacement, swapInRound, swapTeamsInRound, waitingToStart } from "../src/shared/swap";
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

describe("waitingToStart (a game dealt up next that can't have begun)", () => {
  const playing = [
    { court: 1, players: ["a", "b", "c", "d"], finished: false },
    { court: 2, players: ["e", "f", "g", "h"], finished: true },
  ];
  it("waits while its court is still in use", () => {
    expect(waitingToStart(playing, { court: 1, players: ["w", "x", "y", "z"] })).toBe(true);
  });
  it("waits while one of its four is still finishing a game", () => {
    expect(waitingToStart(playing, { court: 2, players: ["a", "x", "y", "z"] })).toBe(true);
  });
  it("may have started once its court is free and all four are free", () => {
    expect(waitingToStart(playing, { court: 2, players: ["e", "f", "y", "z"] })).toBe(false);
    expect(waitingToStart(playing, { court: 3, players: ["w", "x", "y", "z"] })).toBe(false);
  });
});

describe("pickReplacement (who comes on for a player moved to the beginner court)", () => {
  const base = { sitters: ["s1", "s2", "s3"], out: "p", games: { s1: 2, s2: 1, s3: 1 }, sitOuts: { s1: 1, s2: 1, s3: 3 } };
  it("takes whoever has played least, then whoever has sat most", () => {
    expect(pickReplacement(base)).toBe("s3");
    expect(pickReplacement({ ...base, sitOuts: { s1: 1, s2: 1, s3: 1 } })).toBe("s2");
  });
  it("with mixed pairs, someone of the same gender first so the team stays mixed", () => {
    const genders = { p: "woman", s1: "woman", s2: "man", s3: "man" };
    expect(pickReplacement({ ...base, genders, mixedPairs: true })).toBe("s1");
    expect(pickReplacement({ ...base, genders, mixedPairs: false })).toBe("s3");
    // Nobody of that gender sitting: the usual order.
    expect(pickReplacement({ ...base, genders: { ...genders, s1: "man" }, mixedPairs: true })).toBe("s3");
  });
  it("never picks the player going off, and gives up when nobody is sitting", () => {
    expect(pickReplacement({ ...base, sitters: ["p"] })).toBeNull();
    expect(pickReplacement({ ...base, sitters: [] })).toBeNull();
  });
});
