import { describe, expect, it } from "vitest";
import { estimateRounds, minutesPerMatch, rosterSplit } from "../src/shared/timing";

describe("pacing", () => {
  it("fits 7 rounds of 16 points or 5 rounds of 24 in a 90-minute booking", () => {
    expect(minutesPerMatch(16)).toBe(11);
    expect(minutesPerMatch(24)).toBe(15);
    expect(estimateRounds(90, 16)).toBe(7);
    expect(estimateRounds(90, 24)).toBe(5);
  });
});

describe("rosterSplit", () => {
  it("11 players on 2 courts over 7 rounds: 3 sit each round, everyone sits 1–2 and plays 5–6", () => {
    expect(rosterSplit(11, 2, 7)).toEqual({
      courtsUsed: 2,
      sittingPerRound: 3,
      sitMin: 1,
      sitMax: 2,
      playMin: 5,
      playMax: 6,
    });
  });

  it("12 players on 2 courts over 5 rounds: plays 3–4, sits 1–2", () => {
    const s = rosterSplit(12, 2, 5);
    expect([s.playMin, s.playMax]).toEqual([3, 4]);
    expect([s.sitMin, s.sitMax]).toEqual([1, 2]);
  });

  it("a full set of courts means nobody sits", () => {
    expect(rosterSplit(8, 2, 7)).toMatchObject({ sittingPerRound: 0, sitMin: 0, sitMax: 0, playMin: 7, playMax: 7 });
  });

  it("a group too small for every court leaves one empty", () => {
    // 7 players can only fill 1 of 2 courts: 3 sit every round, 21 sit-outs shared by 7.
    expect(rosterSplit(7, 2, 7)).toMatchObject({ courtsUsed: 1, sittingPerRound: 3, sitMin: 3, sitMax: 3, playMin: 4 });
  });
});

describe("12-point games", () => {
  it("run ~9 minutes, so 90 minutes fits 8 rounds", () => {
    expect(minutesPerMatch(12)).toBe(9);
    expect(estimateRounds(90, 12)).toBe(8);
  });
});
