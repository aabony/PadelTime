import { describe, expect, it } from "vitest";
import { americano } from "../src/shared/formats/americano";
import { mulberry32, pairKey } from "../src/shared/formats/types";
import type { EngineContext } from "../src/shared/formats/types";
import { buildHistory } from "../src/shared/history";
import type { HistoryRound } from "../src/shared/history";
import { computeStandings } from "../src/shared/standings";
import type { RoundRow } from "../src/shared/types";
import { americano as legacyAmericano } from "./legacy/americano.legacy";
import { byeSpread, mixedRoster, mixesBeginners, playNight } from "./helpers/night";

function makeCtx(players: string[], courts: number, roundsPlayed: HistoryRound[], seed = 42): EngineContext {
  const h = buildHistory(roundsPlayed);
  return {
    players,
    courts,
    roundNumber: roundsPlayed.length + 1,
    ...h,
    standings: [],
    rng: mulberry32(seed),
  };
}

function playRounds(players: string[], courts: number, count: number, seed = 42): HistoryRound[] {
  const history: HistoryRound[] = [];
  for (let i = 0; i < count; i++) {
    const plan = americano.planRound(makeCtx(players, courts, history, seed + i));
    history.push({
      number: i + 1,
      byes: plan.byes,
      matches: plan.matches.map((m) => ({ a: m.a, b: m.b })),
    });
  }
  return history;
}

const names = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe("americano round planning", () => {
  it("fills courts and assigns everyone exactly once per round", () => {
    const players = names(8);
    const plan = americano.planRound(makeCtx(players, 2, []));
    expect(plan.matches).toHaveLength(2);
    expect(plan.byes).toHaveLength(0);
    const seen = plan.matches.flatMap((m) => [...m.a, ...m.b]);
    expect(new Set(seen).size).toBe(8);
  });

  it("respects the court limit", () => {
    const players = names(12);
    const plan = americano.planRound(makeCtx(players, 2, []));
    expect(plan.matches).toHaveLength(2);
    expect(plan.byes).toHaveLength(4);
  });

  it("gives byes to players who have sat out least", () => {
    const players = names(5);
    const rounds = playRounds(players, 1, 5);
    const byeCounts: Record<string, number> = {};
    for (const r of rounds) for (const b of r.byes) byeCounts[b] = (byeCounts[b] ?? 0) + 1;
    // 5 rounds, 5 players, 1 bye per round → everyone sits exactly once
    for (const p of players) expect(byeCounts[p] ?? 0).toBe(1);
  });

  it("keeps bye spread fair for 15 players on 3 courts", () => {
    const players = names(15);
    const rounds = playRounds(players, 3, 5);
    const byeCounts: Record<string, number> = {};
    for (const r of rounds) {
      expect(r.byes).toHaveLength(3);
      for (const b of r.byes) byeCounts[b] = (byeCounts[b] ?? 0) + 1;
    }
    // 15 byes over 15 players → exactly one each
    for (const p of players) expect(byeCounts[p] ?? 0).toBe(1);
  });

  it("maximises partner diversity — 8 players, 7 rounds, few repeats", () => {
    const players = names(8);
    const rounds = playRounds(players, 2, 7);
    const partnerCounts: Record<string, number> = {};
    for (const r of rounds) {
      for (const m of r.matches) {
        partnerCounts[pairKey(m.a[0], m.a[1])] = (partnerCounts[pairKey(m.a[0], m.a[1])] ?? 0) + 1;
        partnerCounts[pairKey(m.b[0], m.b[1])] = (partnerCounts[pairKey(m.b[0], m.b[1])] ?? 0) + 1;
      }
    }
    const repeats = Object.values(partnerCounts).filter((c) => c > 1).length;
    // Perfect whist rotation has 0 repeats in 7 rounds; the stochastic search
    // should land at most a couple.
    expect(repeats).toBeLessThanOrEqual(2);
    // Everyone plays all 7 rounds
    const h = buildHistory(rounds);
    for (const p of players) expect(h.playedCounts[p]).toBe(7);
  });

  it("never repeats a partner in the first rounds when avoidable (12 players)", () => {
    const players = names(12);
    const rounds = playRounds(players, 3, 4);
    const partnerCounts: Record<string, number> = {};
    for (const r of rounds) {
      for (const m of r.matches) {
        for (const key of [pairKey(m.a[0], m.a[1]), pairKey(m.b[0], m.b[1])]) {
          partnerCounts[key] = (partnerCounts[key] ?? 0) + 1;
        }
      }
    }
    expect(Object.values(partnerCounts).every((c) => c === 1)).toBe(true);
  });

  it("handles fewer than 4 players by sitting everyone", () => {
    const plan = americano.planRound(makeCtx(names(3), 2, []));
    expect(plan.matches).toHaveLength(0);
    expect(plan.byes).toHaveLength(3);
  });
});

describe("standings", () => {
  it("credits team points to each player and ranks by points", () => {
    const players = [
      { id: "a", name: "Andrew" },
      { id: "b", name: "Ben" },
      { id: "c", name: "Chris" },
      { id: "d", name: "Dan" },
    ];
    const rounds: RoundRow[] = [
      {
        id: "r1",
        number: 1,
        byes: [],
        complete: true,
        matches: [
          {
            id: "m1",
            roundId: "r1",
            court: 1,
            a: ["a", "b"],
            b: ["c", "d"],
            scoreA: 14,
            scoreB: 10,
            status: "confirmed",
            submittedBy: null,
          },
        ],
      },
      {
        id: "r2",
        number: 2,
        byes: [],
        complete: false,
        matches: [
          {
            id: "m2",
            roundId: "r2",
            court: 1,
            a: ["a", "c"],
            b: ["b", "d"],
            scoreA: 20,
            scoreB: 4,
            status: "submitted", // not confirmed → must not count
            submittedBy: "a",
          },
        ],
      },
    ];
    const standings = computeStandings(players, rounds);
    expect(standings[0].name).toBe("Andrew");
    expect(standings[0].points).toBe(14);
    expect(standings[0].wins).toBe(1);
    const dan = standings.find((s) => s.name === "Dan")!;
    expect(dan.points).toBe(10);
    expect(dan.losses).toBe(1);
    expect(dan.diff).toBe(-4);
  });

  it("counts ties", () => {
    const players = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
      { id: "d", name: "D" },
    ];
    const rounds: RoundRow[] = [
      {
        id: "r1",
        number: 1,
        byes: [],
        complete: true,
        matches: [
          {
            id: "m1",
            roundId: "r1",
            court: 1,
            a: ["a", "b"],
            b: ["c", "d"],
            scoreA: 12,
            scoreB: 12,
            status: "confirmed",
            submittedBy: null,
          },
        ],
      },
    ];
    const standings = computeStandings(players, rounds);
    expect(standings.every((s) => s.ties === 1)).toBe(true);
  });
});

describe("americano level balancing", () => {
  it("splits a court strong + weak vs strong + weak when levels are known", () => {
    const players = ["a", "b", "c", "d"];
    const levels = { a: 4, b: 4, c: 1, d: 1 };
    const plan = americano.planRound({ ...makeCtx(players, 1, []), levels, groupByLevel: true });
    const m = plan.matches[0];
    const sum = (t: [string, string]) => levels[t[0] as keyof typeof levels] + levels[t[1] as keyof typeof levels];
    expect(sum(m.a)).toBe(5);
    expect(sum(m.b)).toBe(5);
  });

  it("never lets balance override partner variety", () => {
    const players = ["a", "b", "c", "d"];
    const levels = { a: 4, b: 4, c: 1, d: 1 };
    // Balanced pairs already played together twice → must rotate partners despite the level gap.
    const history: HistoryRound[] = [
      { number: 1, byes: [], matches: [{ a: ["a", "c"], b: ["b", "d"] }] },
      { number: 2, byes: [], matches: [{ a: ["a", "d"], b: ["b", "c"] }] },
    ];
    const plan = americano.planRound({ ...makeCtx(players, 1, history), levels, groupByLevel: true });
    const m = plan.matches[0];
    expect(new Set([[...m.a].sort().join("+"), [...m.b].sort().join("+")])).toEqual(new Set(["a+b", "c+d"]));
  });
});

describe("americano mixed pairs", () => {
  const genders = { w1: "woman", w2: "woman", w3: "woman", w4: "woman", m1: "man", m2: "man", m3: "man", m4: "man" } as const;
  const mixedTeam = (t: [string, string]) => genders[t[0] as keyof typeof genders] !== genders[t[1] as keyof typeof genders];

  it("makes every team one woman + one man when the numbers allow", () => {
    const players = Object.keys(genders);
    for (let seed = 1; seed <= 5; seed++) {
      const plan = americano.planRound({ ...makeCtx(players, 2, [], seed), genders, mixedPairs: true });
      expect(plan.matches).toHaveLength(2);
      for (const m of plan.matches) {
        expect(mixedTeam(m.a)).toBe(true);
        expect(mixedTeam(m.b)).toBe(true);
      }
    }
  });

  it("keeps mixing across rounds without repeating partners", () => {
    const players = Object.keys(genders);
    const history: HistoryRound[] = [];
    for (let r = 1; r <= 4; r++) {
      const plan = americano.planRound({ ...makeCtx(players, 2, history, r), genders, mixedPairs: true });
      for (const m of plan.matches) {
        expect(mixedTeam(m.a)).toBe(true);
        expect(mixedTeam(m.b)).toBe(true);
      }
      history.push({ number: r, byes: plan.byes, matches: plan.matches.map((m) => ({ a: m.a, b: m.b })) });
    }
    const partners: Record<string, number> = {};
    for (const r of history) for (const m of r.matches) for (const t of [m.a, m.b]) partners[pairKey(t[0], t[1])] = (partners[pairKey(t[0], t[1])] ?? 0) + 1;
    expect(Object.values(partners).every((v) => v === 1)).toBe(true);
  });

  it("ignores the option when a court can't be mixed", () => {
    const players = ["w1", "w2", "w3", "w4"];
    const plan = americano.planRound({ ...makeCtx(players, 1, []), genders, mixedPairs: true });
    expect(plan.matches).toHaveLength(1);
  });
});

describe("americano grouped by playing level", () => {
  const sameCourt = (m: { a: [string, string]; b: [string, string] }) => new Set([...m.a, ...m.b]);

  it("toggle off plans exactly as before, mixed pairs included", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { players } = mixedRoster(seed);
      expect(playNight(americano.planRound, { players, courts: 2, rounds: 7, seed }).map((r) => r.plan)).toEqual(
        playNight(legacyAmericano.planRound, { players, courts: 2, rounds: 7, seed }).map((r) => r.plan),
      );
    }
    const genders = Object.fromEntries(names(12).map((p, i) => [p, i % 3 === 0 ? "woman" : "man"] as const));
    for (let seed = 1; seed <= 8; seed++) {
      const night = { players: names(12), courts: 2, rounds: 6, seed, genders, mixedPairs: true };
      expect(playNight(americano.planRound, night).map((r) => r.plan)).toEqual(
        playNight(legacyAmericano.planRound, night).map((r) => r.plan),
      );
    }
  }, 60_000);

  it("4 beginners + 4 advanced on 2 courts: every court is one level, every round", () => {
    const players = ["b1", "b2", "b3", "b4", "a1", "a2", "a3", "a4"];
    const levels = { b1: 2, b2: 2, b3: 2, b4: 2, a1: 4, a2: 4, a3: 4, a4: 4 };
    const night = playNight(americano.planRound, { players, courts: 2, rounds: 6, seed: 3, levels, groupByLevel: true });
    for (const { plan } of night) {
      const courts = plan.matches.map(sameCourt);
      expect(courts).toContainEqual(new Set(["b1", "b2", "b3", "b4"]));
      expect(courts).toContainEqual(new Set(["a1", "a2", "a3", "a4"]));
    }
    // partners still rotate inside a level: the first three rounds use all three pairings
    const partners = new Set(night.slice(0, 3).flatMap(({ plan }) => plan.matches.flatMap((m) => [m.a, m.b].map((t) => [...t].sort().join("+")))));
    expect(partners.size).toBe(12);
  });

  it("unset players count as intermediate, so they play with the stronger group", () => {
    const players = ["b1", "b2", "b3", "b4", "u1", "u2", "a1", "a2"];
    const levels = { b1: 2, b2: 2, b3: 2, b4: 2, a1: 4, a2: 4 };
    for (let seed = 1; seed <= 5; seed++) {
      const plan = americano.planRound({ ...makeCtx(players, 2, [], seed), levels, groupByLevel: true });
      expect(plan.matches.map(sameCourt)).toContainEqual(new Set(["b1", "b2", "b3", "b4"]));
    }
  });

  it("18 players on 2 courts: no beginner's first game is with stronger players, sit-outs stay fair", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { players, levels } = mixedRoster(seed);
      const night = playNight(americano.planRound, { players, courts: 2, rounds: 7, seed, levels, groupByLevel: true });
      for (const { plan, firstGame } of night) {
        for (const m of plan.matches) {
          const four = [...m.a, ...m.b];
          if (four.some((p) => firstGame.has(p))) expect(mixesBeginners(four, levels)).toBe(false);
        }
      }
      expect(byeSpread(night, players)).toBeLessThanOrEqual(1);
    }
  }, 60_000);
});
