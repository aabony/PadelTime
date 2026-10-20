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

  // When exactly half the teams sit, the plain rotation splits the night into two
  // halves that never meet (4 teams on 1 court: the same match all night).
  for (const [name, planner] of [["casual", americano.planRound], ["competitive", mexicano.planRound]] as const) {
    it(`${name}: 4 teams on 1 court meet every other team, sit-outs stay even`, () => {
      const teams = teamsOf(4);
      const players = teams.flat();
      for (let seed = 1; seed <= 10; seed++) {
        const night = playNight(planner, { players, courts: 1, rounds: 8, seed, teams });
        const opponents = new Map<string, Set<string>>();
        for (const { plan } of night) {
          for (const m of plan.matches) {
            (opponents.get(key(m.a)) ?? opponents.set(key(m.a), new Set()).get(key(m.a))!).add(key(m.b));
            (opponents.get(key(m.b)) ?? opponents.set(key(m.b), new Set()).get(key(m.b))!).add(key(m.a));
          }
        }
        for (const t of teams) expect(opponents.get(key(t))?.size).toBe(3);
        expect(byeSpread(night, players)).toBe(0);
      }
    });
  }

  it("casual: 8 teams on 2 courts mix both halves — no rematch in 9 rounds", () => {
    const teams = teamsOf(8);
    for (let seed = 1; seed <= 10; seed++) {
      const night = playNight(americano.planRound, { players: teams.flat(), courts: 2, rounds: 9, seed, teams });
      const met = night.flatMap(({ plan }) => plan.matches.map((m) => [key(m.a), key(m.b)].sort().join(" v ")));
      expect(new Set(met).size).toBe(met.length);
      expect(byeSpread(night, teams.flat())).toBeLessThanOrEqual(1);
    }
  });

  // Whole groups (8 teams, 4 on court: two halves; 12 on 3 courts likewise) would
  // otherwise come back cycle after cycle and never meet the other group.
  for (const [name, planner] of [["casual", americano.planRound], ["competitive", mexicano.planRound]] as const) {
    it(`${name}: groups mix early — 8 teams on 2 courts, 12 on 3, 12 on 2 and 6 on 1 all connect within a typical night`, () => {
      for (const [count, courts, by] of [[8, 2, 7], [12, 3, 8], [12, 2, 9], [6, 1, 6]]) {
        const teams = teamsOf(count);
        for (let seed = 1; seed <= 8; seed++) {
          const night = playNight(planner, { players: teams.flat(), courts, rounds: by, seed, teams });
          const group = new Map(teams.map((t) => [key(t), key(t)]));
          const find = (x: string): string => (group.get(x) === x ? x : find(group.get(x)!));
          for (const { plan } of night) for (const m of plan.matches) group.set(find(key(m.a)), find(key(m.b)));
          expect(new Set(teams.map((t) => find(key(t)))).size).toBe(1);
          expect(byeSpread(night, teams.flat())).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  for (const [name, planner] of [["casual", americano.planRound], ["competitive", mexicano.planRound]] as const) {
    it(`${name}: 6 teams on 1 court — no rematch in 10 rounds (15 match-ups to go round)`, () => {
      const teams = teamsOf(6);
      for (let seed = 1; seed <= 10; seed++) {
        const night = playNight(planner, { players: teams.flat(), courts: 1, rounds: 10, seed, teams });
        const met = night.flatMap(({ plan }) => plan.matches.map((m) => [key(m.a), key(m.b)].sort().join(" v ")));
        expect(new Set(met).size).toBe(met.length);
      }
    });
  }

  it("nobody sits out more than 3 rounds in a row (6 teams on 1 court), or 2 when half sit", () => {
    for (const [count, courts, most] of [[6, 1, 3], [4, 1, 2], [8, 2, 2], [12, 3, 2]]) {
      const teams = teamsOf(count);
      for (let seed = 1; seed <= 6; seed++) {
        const night = playNight(americano.planRound, { players: teams.flat(), courts, rounds: 9, seed, teams });
        for (const [a] of teams) {
          let run = 0;
          for (const { plan } of night) {
            run = plan.byes.includes(a) ? run + 1 : 0;
            expect(run).toBeLessThanOrEqual(most);
          }
        }
      }
    }
  });

  it("stays quick on a 64-player night (32 teams, 4 courts)", () => {
    const teams = teamsOf(32);
    for (const planner of [americano.planRound, mexicano.planRound]) {
      const start = performance.now();
      playNight(planner, { players: teams.flat(), courts: 4, rounds: 6, seed: 1, teams });
      expect((performance.now() - start) / 6).toBeLessThan(500);
    }
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

  it("leaves the last player on the list out when the number is odd", () => {
    const teams = autoPair(["a", "b", "c", "d", "e"], { rng: rng() });
    expect(teams).toHaveLength(2);
    expect(new Set(teams.flat())).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("mixed pairs + grouping: partners of the same level, not the strongest men for the women", () => {
    const genders = { w1: "woman", w2: "woman", m1: "man", m2: "man", m3: "man", m4: "man" } as const;
    const levels = { w1: 2, w2: 2, m1: 4, m2: 4, m3: 2, m4: 2 };
    const teams = autoPair(["w1", "w2", "m1", "m2", "m3", "m4"], { genders, levels, mixedPairs: true, groupByLevel: true, rng: rng() });
    expect(teams).toHaveLength(3);
    for (const t of teams) expect(levels[t[0] as keyof typeof levels]).toBe(levels[t[1] as keyof typeof levels]);
    expect(teams.filter((t) => t.some((p) => p.startsWith("w"))).every((t) => t.some((p) => p.startsWith("m")))).toBe(true);
  });

  it("finds the best pairing — checked against every possible pairing on small rosters", () => {
    const r = mulberry32(2024);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    for (let trial = 0; trial < 400; trial++) {
      const n = 2 * (1 + Math.floor(r() * 4)); // 2..8 players, even
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const levels: Record<string, number> = {};
      const genders: Record<string, "woman" | "man"> = {};
      for (const p of ids) {
        const lv = pick([2, 3, 4, 0]);
        if (lv) levels[p] = lv;
        const g = pick(["woman", "man", "man", ""] as const);
        if (g) genders[p] = g;
      }
      const groupByLevel = r() < 0.5;
      const mixedPairs = r() < 0.6;
      const level = (p: string) => levels[p] ?? 3;
      const mean = ids.reduce((sum, p) => sum + level(p), 0) / n;
      const cost = (t: string[]) => (groupByLevel ? (level(t[0]) - level(t[1])) ** 2 : (level(t[0]) + level(t[1]) - 2 * mean) ** 2);
      const mixed = (t: string[]) => !!genders[t[0]] && !!genders[t[1]] && genders[t[0]] !== genders[t[1]];
      const women = ids.filter((p) => genders[p] === "woman").length;
      const men = ids.filter((p) => genders[p] === "man").length;
      const needMixed = mixedPairs ? Math.min(women, men) : 0;
      // Every perfect matching, best cost among those with the most mixed teams.
      let best = Infinity;
      const all = (left: string[], teams: string[][]) => {
        if (left.length === 0) {
          if (teams.filter(mixed).length >= needMixed) best = Math.min(best, teams.reduce((sum, t) => sum + cost(t), 0));
          return;
        }
        for (let j = 1; j < left.length; j++) all(left.filter((_, k) => k !== 0 && k !== j), [...teams, [left[0], left[j]]]);
      };
      all(ids, []);
      const got = autoPair(ids, { levels, genders, groupByLevel, mixedPairs, rng: mulberry32(trial) });
      expect(got).toHaveLength(n / 2);
      expect(new Set(got.flat()).size).toBe(n);
      if (mixedPairs) expect(got.filter(mixed).length).toBe(needMixed);
      expect(got.reduce((sum, t) => sum + cost(t), 0)).toBeLessThanOrEqual(best + 1e-9);
    }
  });

  it("mixed pairs: teams as even as the genders allow", () => {
    const genders = { w1: "woman", w2: "woman", m1: "man", m2: "man", m3: "man", m4: "man" } as const;
    const levels = { w1: 4, w2: 4, m1: 4, m2: 4, m3: 2, m4: 2 };
    const teams = autoPair(["w1", "w2", "m1", "m2", "m3", "m4"], { genders, levels, mixedPairs: true, rng: rng() });
    const totals = teams.map((t) => levels[t[0] as keyof typeof levels] + levels[t[1] as keyof typeof levels]).sort();
    expect(totals).toEqual([6, 6, 8]); // not 8 + 8 + 4 (the strong women with the strong men, the beginners together)
    expect(teams.filter((t) => t.some((p) => p.startsWith("w"))).every((t) => t.some((p) => p.startsWith("m")))).toBe(true);
  });
});
