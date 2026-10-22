import { describe, expect, it } from "vitest";
import { compareGameLengths, estimateRounds, minutesPerMatch, recommendSetup, rosterSplit, rosterWarnings, sweetSpot } from "../src/shared/timing";

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

describe("equal-games suggestion", () => {
  const rec = (players: number, courts: number, duration: number) => {
    const r = recommendSetup(players, courts, duration)!;
    return [r.points, r.rounds, r.gamesEach, r.stopAfter];
  };

  it("picks the game length that gives everyone the same number of games (2 courts, 90 min)", () => {
    expect(rec(10, 2, 90)).toEqual([24, 5, 4, null]);
    expect(rec(12, 2, 90)).toEqual([18, 6, 4, null]);
    expect(rec(14, 2, 90)).toEqual([16, 7, 4, null]);
    expect(rec(16, 2, 90)).toEqual([14, 8, 4, null]);
    expect(rec(20, 2, 90)).toEqual([10, 10, 4, null]); // never just 2 games each
  });

  it("allows stopping one round early when nothing fits exactly", () => {
    expect(rec(18, 2, 90)).toEqual([10, 9, 4, 9]); // 10 rounds fit; stop after 9
  });

  it("says so when games can't come out even", () => {
    const r = recommendSetup(17, 2, 90)!;
    expect(r.equalGames).toBe(false);
    expect(r.gamesEach).toBeNull();
  });

  it("works for other bookings too", () => {
    expect(rec(12, 2, 120)).toEqual([18, 9, 6, null]);
    expect(rec(12, 2, 60)).toEqual([10, 6, 4, null]);
  });

  it("leaves full-court nights as they were", () => {
    expect(recommendSetup(12, 3, 90)).toMatchObject({ points: 16, rounds: 7, equalGames: true, gamesEach: 7 });
  });
});

describe("roster warnings", () => {
  it("flags the half-sit split and long waits", () => {
    expect(rosterWarnings(16, 2)).toEqual({ splitGroups: true, longWaits: false });
    expect(rosterWarnings(24, 3)).toEqual({ splitGroups: true, longWaits: false });
    expect(rosterWarnings(17, 2)).toEqual({ splitGroups: false, longWaits: true });
    expect(rosterWarnings(18, 2)).toEqual({ splitGroups: false, longWaits: true });
    expect(rosterWarnings(12, 2)).toEqual({ splitGroups: false, longWaits: false });
  });

  it("puts the sweet spot for 2 courts at 10–14 players", () => {
    expect(sweetSpot(2)).toEqual({ min: 10, max: 14 });
  });
});

describe("game length comparison", () => {
  it("12 players on 2 courts, 90 min: each length's rounds, games and sit-outs", () => {
    const rows = compareGameLengths(12, 2, 90, 24);
    expect(rows.map((r) => r.points)).toEqual([24, 21, 18, 16, 14, 12]);
    const by = Object.fromEntries(rows.map((r) => [r.points, r]));
    expect(by[24]).toMatchObject({ rounds: 5, playMin: 3, playMax: 4, sitMin: 1, sitMax: 2, even: false });
    expect(by[18]).toMatchObject({ rounds: 6, playMin: 4, playMax: 4, sitMin: 2, sitMax: 2, even: true });
  });

  it("adds an unusual current length, and needs a court time", () => {
    expect(compareGameLengths(12, 2, 90, 15).map((r) => r.points)).toContain(15);
    expect(compareGameLengths(12, 2, null, 24)).toEqual([]);
  });
});
