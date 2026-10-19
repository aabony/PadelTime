import { describe, expect, it } from "vitest";
import { americano } from "../src/shared/formats/americano";
import { mexicano } from "../src/shared/formats/mexicano";
import { autoPair } from "../src/shared/formats/teams";
import { buildHistory } from "../src/shared/history";
import type { HistoryRound } from "../src/shared/history";
import { mulberry32, pairKey } from "../src/shared/formats/types";
import type { EngineContext } from "../src/shared/formats/types";
import { byeSpread, playNight } from "./helpers/night";

const teamsOf = (n: number): [string, string][] => Array.from({ length: n }, (_, i) => [`t${i}a`, `t${i}b`]);
const sameTeam = (pair: [string, string], teams: [string, string][]) => teams.some((t) => pairKey(t[0], t[1]) === pairKey(pair[0], pair[1]));
const key = (t: [string, string]) => pairKey(t[0], t[1]);

describe("keep teams together", () => {
  for (const [name, planner] of [["casual", americano.planRound], ["competitive", mexicano.planRound]] as const) {
    it(`${name}: partners always play together, and a pair sits out together`, () => {
      const teams = teamsOf(6);
      const players = teams.flat();
      const night = playNight(planner, { players, courts: 2, rounds: 8, seed: 3, teams });
      for (const { plan } of night) {
        expect(plan.matches).toHaveLength(2);
        for (const m of plan.matches) {
          expect(sameTeam(m.a, teams)).toBe(true);
          expect(sameTeam(m.b, teams)).toBe(true);
        }
        for (const [a, b] of teams) expect(plan.byes.includes(a)).toBe(plan.byes.includes(b));
      }
      expect(byeSpread(night, players)).toBeLessThanOrEqual(1);
    });
  }

  it("casual: teams meet different teams before any rematch (6 teams, 2 courts)", () => {
    const teams = teamsOf(6);
    const players = teams.flat();
    for (let seed = 1; seed <= 10; seed++) {
      const night = playNight(americano.planRound, { players, courts: 2, rounds: 7, seed, teams });
      const met = new Map<string, number>();
      for (const { plan } of night) {
        for (const m of plan.matches) {
          const k = [key(m.a), key(m.b)].sort().join(" v ");
          met.set(k, (met.get(k) ?? 0) + 1);
        }
      }
      // 7 rounds × 2 courts = 14 match-ups out of 15 possible: none repeated.
      expect([...met.values()].every((n) => n === 1)).toBe(true);
    }
  });

  it("casual: with every team on court (6 teams, 3 courts), 5 rounds are a full round robin", () => {
    const teams = teamsOf(6);
    for (let seed = 1; seed <= 20; seed++) {
      const night = playNight(americano.planRound, { players: teams.flat(), courts: 3, rounds: 5, seed, teams });
      const met = new Set(night.flatMap(({ plan }) => plan.matches.map((m) => [key(m.a), key(m.b)].sort().join(" v "))));
      expect(met.size).toBe(15);
    }
  });

  it("competitive: the top two teams play on court 1", () => {
    const teams = teamsOf(4);
    const players = teams.flat();
    const standings = [
      ["t2a", 30], ["t2b", 30], ["t0a", 25], ["t0b", 25], ["t3a", 20], ["t3b", 20], ["t1a", 10], ["t1b", 10],
    ].map(([playerId, points]) => ({ playerId: playerId as string, points: points as number, played: 2 }));
    const ctx: EngineContext = { players, courts: 2, roundNumber: 3, ...buildHistory([]), standings, teams, rng: mulberry32(1) };
    const plan = mexicano.planRound(ctx);
    const top = plan.matches.find((m) => m.court === 1)!;
    expect(new Set([key(top.a), key(top.b)])).toEqual(new Set([pairKey("t2a", "t2b"), pairKey("t0a", "t0b")]));
  });

  it("competitive: swaps courts to avoid a rematch when that helps", () => {
    const teams = teamsOf(4);
    const players = teams.flat();
    // Teams 0 and 1 just played each other; the ladder would pair them again on court 1.
    const history: HistoryRound[] = [{ number: 1, byes: [], matches: [{ a: teams[0], b: teams[1] }, { a: teams[2], b: teams[3] }] }];
    const standings = [["t0a", 30], ["t0b", 30], ["t1a", 29], ["t1b", 29], ["t2a", 20], ["t2b", 20], ["t3a", 19], ["t3b", 19]].map(
      ([playerId, points]) => ({ playerId: playerId as string, points: points as number, played: 1 }),
    );
    const plan = mexicano.planRound({ players, courts: 2, roundNumber: 2, ...buildHistory(history), standings, teams, rng: mulberry32(2) });
    const top = plan.matches.find((m) => m.court === 1)!;
    expect(new Set([key(top.a), key(top.b)])).toEqual(new Set([pairKey("t0a", "t0b"), pairKey("t2a", "t2b")]));
  });

  it("players without a playable partner sit out", () => {
    const teams = teamsOf(4);
    const players = [...teams.flat().filter((p) => p !== "t3b"), "solo"]; // t3b isn't here; solo has no partner
    const plan = americano.planRound({ players, courts: 2, roundNumber: 1, ...buildHistory([]), standings: [], teams, rng: mulberry32(4) });
    expect(plan.matches).toHaveLength(1); // 3 playable teams → 1 court
    expect(plan.byes).toEqual(expect.arrayContaining(["t3a", "solo"]));
  });
});

describe("auto-pairing", () => {
  const rng = () => mulberry32(9);
  it("pairs strongest with weakest by default", () => {
    const levels = { a: 4, b: 4, c: 2, d: 2 };
    const teams = autoPair(["a", "b", "c", "d"], { levels, rng: rng() });
    for (const t of teams) expect(t.map((p) => levels[p as keyof typeof levels]).sort()).toEqual([2, 4]);
  });

  it("pairs the same level together when grouping by level", () => {
    const levels = { a: 4, b: 4, c: 2, d: 2 };
    const teams = autoPair(["a", "c", "b", "d"], { levels, groupByLevel: true, rng: rng() });
    for (const t of teams) expect(levels[t[0] as keyof typeof levels]).toBe(levels[t[1] as keyof typeof levels]);
  });

  it("pairs a woman with a man under mixed pairs", () => {
    const genders = { w1: "woman", w2: "woman", m1: "man", m2: "man" } as const;
    const teams = autoPair(["w1", "w2", "m1", "m2"], { genders, mixedPairs: true, rng: rng() });
    expect(teams).toHaveLength(2);
    for (const t of teams) expect(new Set(t.map((p) => genders[p as keyof typeof genders]))).toEqual(new Set(["woman", "man"]));
  });

  it("leaves an odd player out", () => {
    const teams = autoPair(["a", "b", "c", "d", "e"], { rng: rng() });
    expect(teams).toHaveLength(2);
    expect(new Set(teams.flat()).size).toBe(4);
  });
});
