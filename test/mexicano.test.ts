import { describe, expect, it } from "vitest";
import { mexicano } from "../src/shared/formats/mexicano";
import { mulberry32 } from "../src/shared/formats/types";
import type { EngineContext } from "../src/shared/formats/types";
import { buildHistory, creditAbsences } from "../src/shared/history";
import type { HistoryRound } from "../src/shared/history";
import { mexicano as legacyMexicano } from "./legacy/mexicano.legacy";
import { byeSpread, mixedRoster, mixesBeginners, playNight } from "./helpers/night";

const names = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

function ctxOf(
  players: string[],
  courts: number,
  history: HistoryRound[],
  standings: EngineContext["standings"],
  seed = 7,
): EngineContext {
  return {
    players,
    courts,
    roundNumber: history.length + 1,
    ...buildHistory(history),
    standings,
    rng: mulberry32(seed),
  };
}

/** Standings with p1 on top, descending. */
const ladder = (ids: string[]) => ids.map((playerId, i) => ({ playerId, points: 100 - i * 5 }));
const team = (t: [string, string]) => [...t].sort().join("+");
const courtOf = (plan: ReturnType<typeof mexicano.planRound>, court: number) => plan.matches.find((m) => m.court === court)!;

describe("mexicano round planning", () => {
  it("round 1 is a random draw that fills every court", () => {
    const plan = mexicano.planRound(ctxOf(names(8), 2, [], []));
    expect(plan.matches).toHaveLength(2);
    expect(plan.byes).toHaveLength(0);
    expect(new Set(plan.matches.flatMap((m) => [...m.a, ...m.b])).size).toBe(8);
  });

  it("deals courts from the standings: top four on court 1, 1st & 4th vs 2nd & 3rd", () => {
    const players = names(8);
    const plan = mexicano.planRound(ctxOf(players, 2, [], ladder(players)));
    const c1 = courtOf(plan, 1);
    const c2 = courtOf(plan, 2);
    expect(new Set([team(c1.a), team(c1.b)])).toEqual(new Set(["p1+p4", "p2+p3"]));
    expect(new Set([team(c2.a), team(c2.b)])).toEqual(new Set(["p5+p8", "p6+p7"]));
  });

  it("ranks by the standings order, not by player list order", () => {
    const players = names(8);
    // Reverse ladder: p8 leads.
    const standings = ladder([...players].reverse());
    const plan = mexicano.planRound(ctxOf(players, 2, [], standings));
    const c1 = courtOf(plan, 1);
    expect(new Set([...c1.a, ...c1.b])).toEqual(new Set(["p8", "p7", "p6", "p5"]));
    expect(new Set([team(c1.a), team(c1.b)])).toEqual(new Set(["p5+p8", "p6+p7"]));
  });

  it("puts players without results on the bottom court", () => {
    const players = names(8);
    const plan = mexicano.planRound(ctxOf(players, 2, [], ladder(players.slice(0, 6))));
    const bottom = courtOf(plan, 2);
    expect([...bottom.a, ...bottom.b]).toEqual(expect.arrayContaining(["p7", "p8"]));
  });

  it("only leaves the balanced split to avoid a repeat partnership", () => {
    const players = names(4);
    const history: HistoryRound[] = [{ number: 1, byes: [], matches: [{ a: ["p1", "p4"], b: ["p2", "p3"] }] }];
    const plan = mexicano.planRound(ctxOf(players, 1, history, ladder(players)));
    const c1 = courtOf(plan, 1);
    // p1 & p4 already partnered → next-most-balanced split: 1 & 3 vs 2 & 4
    expect(new Set([team(c1.a), team(c1.b)])).toEqual(new Set(["p1+p3", "p2+p4"]));
  });

  it("rotates byes fairly instead of benching the bottom of the table", () => {
    const players = names(5);
    const history: HistoryRound[] = [
      { number: 1, byes: ["p5"], matches: [{ a: ["p1", "p2"], b: ["p3", "p4"] }] },
    ];
    const plan = mexicano.planRound(ctxOf(players, 1, history, ladder(players)));
    expect(plan.byes).toHaveLength(1);
    expect(plan.byes[0]).not.toBe("p5"); // p5 already sat out
  });
});

describe("group players by playing level", () => {
  it("seeds round 1 from levels: advanced players on court 1", () => {
    const players = names(8);
    const levels = { p1: 1, p2: 4, p3: 2, p4: 4, p5: 3, p6: 4, p7: 3, p8: 2 };
    const plan = mexicano.planRound({ ...ctxOf(players, 2, [], []), levels, groupByLevel: true });
    const top = courtOf(plan, 1);
    const topIds = new Set([...top.a, ...top.b]);
    // the three advanced players plus one intermediate
    expect(topIds.has("p2") && topIds.has("p4") && topIds.has("p6")).toBe(true);
    expect([...topIds].filter((id) => levels[id as keyof typeof levels] === 3)).toHaveLength(1);
    // strongest + weakest on the court are partners
    const inter = [...topIds].find((id) => levels[id as keyof typeof levels] === 3)!;
    const partnerOfInter = [top.a, top.b].find((t) => t.includes(inter))!.find((id) => id !== inter)!;
    expect(levels[partnerOfInter as keyof typeof levels]).toBe(4);
  });

  it("ignores levels when the toggle is off: round 1 is the plain draw", () => {
    const levels = { p1: 2, p2: 4, p3: 2, p4: 4, p5: 3, p6: 4, p7: 3, p8: 2 };
    const plain = mexicano.planRound(ctxOf(names(8), 2, [], []));
    expect(mexicano.planRound({ ...ctxOf(names(8), 2, [], []), levels })).toEqual(plain);
  });

  it("toggle off plans exactly as before, mixed pairs included", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { players } = mixedRoster(seed);
      expect(playNight(mexicano.planRound, { players, courts: 2, rounds: 7, seed }).map((r) => r.plan)).toEqual(
        playNight(legacyMexicano.planRound, { players, courts: 2, rounds: 7, seed }).map((r) => r.plan),
      );
    }
    const genders = Object.fromEntries(names(12).map((p, i) => [p, i % 3 === 0 ? "woman" : "man"] as const));
    for (let seed = 1; seed <= 15; seed++) {
      const night = { players: names(12), courts: 2, rounds: 8, seed, genders, mixedPairs: true };
      expect(playNight(mexicano.planRound, night).map((r) => r.plan)).toEqual(
        playNight(legacyMexicano.planRound, night).map((r) => r.plan),
      );
    }
  }, 60_000);

  it("18 players on 2 courts: no first game mixes beginners with stronger players, sit-outs stay fair", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { players, levels } = mixedRoster(seed);
      const night = playNight(mexicano.planRound, { players, courts: 2, rounds: 9, seed, levels, groupByLevel: true });
      for (const { plan, firstGame } of night) {
        for (const m of plan.matches) {
          const four = [...m.a, ...m.b];
          if (four.some((p) => firstGame.has(p))) expect(mixesBeginners(four, levels)).toBe(false);
        }
      }
      expect(byeSpread(night.slice(0, 7), players)).toBeLessThanOrEqual(1);
      expect(byeSpread(night, players)).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  it("works at other sizes too (12 on 2, 14 and 16 on 3)", () => {
    for (const [size, courts] of [[12, 2], [14, 3], [16, 3]]) {
      for (let seed = 1; seed <= 15; seed++) {
        const { players, levels } = mixedRoster(seed, size);
        const night = playNight(mexicano.planRound, { players, courts, rounds: 7, seed, levels, groupByLevel: true });
        for (const { plan, firstGame } of night) {
          for (const m of plan.matches) {
            const four = [...m.a, ...m.b];
            if (four.some((p) => firstGame.has(p))) expect(mixesBeginners(four, levels)).toBe(false);
          }
        }
        expect(byeSpread(night, players)).toBeLessThanOrEqual(1);
      }
    }
  }, 60_000);

  it("a late-arriving advanced player starts on the top court, not the bottom", () => {
    const players = [...names(7), "late"];
    const levels = { p1: 4, p2: 4, p3: 4, p4: 3, p5: 3, p6: 3, p7: 3, late: 4 };
    const standings = ladder(names(7));
    const off = mexicano.planRound(ctxOf(players, 2, [], standings));
    expect([...courtOf(off, 2).a, ...courtOf(off, 2).b]).toContain("late");
    const on = mexicano.planRound({ ...ctxOf(players, 2, [], standings), levels, groupByLevel: true });
    expect(new Set([...courtOf(on, 1).a, ...courtOf(on, 1).b])).toEqual(new Set(["p1", "p2", "p3", "late"]));
  });

  it("newcomers who are beginners play the beginners, even mid-ladder", () => {
    // Beginners b1/b2 sit mid-table; the ladder alone would put them with x1/x2.
    const players = ["x1", "x2", "b1", "b2", "x3", "x4", "n1", "n2"];
    const levels = { x1: 4, x2: 4, b1: 2, b2: 2, x3: 3, x4: 3, n1: 2, n2: 2 };
    const standings = ladder(players.slice(0, 6));
    const plan = mexicano.planRound({ ...ctxOf(players, 2, [], standings), levels, groupByLevel: true });
    const courtWithNewcomers = plan.matches.find((m) => [...m.a, ...m.b].includes("n1"))!;
    expect(new Set([...courtWithNewcomers.a, ...courtWithNewcomers.b])).toEqual(new Set(["b1", "b2", "n1", "n2"]));
  });

  it("swaps players between courts when splitting at the beginner line isn't possible", () => {
    // Three beginners on court (n1 new), so no all-beginner court exists; n1 should still
    // avoid the advanced players, and newcomer n2 (intermediate) the beginners.
    const players = ["x1", "b1", "x2", "x3", "b2", "x4", "n1", "n2"];
    const levels = { x1: 4, b1: 2, x2: 4, x3: 3, b2: 2, x4: 3, n1: 2, n2: 3 };
    const standings = ladder(players.slice(0, 6));
    for (let seed = 1; seed <= 10; seed++) {
      const plan = mexicano.planRound({ ...ctxOf(players, 2, [], standings, seed), levels, groupByLevel: true });
      const courtOfId = (id: string) => plan.matches.find((m) => [...m.a, ...m.b].includes(id))!;
      const n1 = courtOfId("n1");
      expect([...n1.a, ...n1.b].some((p) => levels[p as keyof typeof levels] === 4)).toBe(false);
      const n2 = courtOfId("n2");
      expect([...n2.a, ...n2.b].some((p) => levels[p as keyof typeof levels] === 2)).toBe(false);
    }
  });

  it("13 players (7 advanced, 6 beginners) on 3 courts: the round-1 sitter's first game stays in level", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const players = names(13);
      const levels = Object.fromEntries(players.map((p, i) => [p, i < 7 ? 4 : 2]));
      const night = playNight(mexicano.planRound, { players, courts: 3, rounds: 3, seed, levels, groupByLevel: true });
      for (const { plan, firstGame } of night) {
        for (const m of plan.matches) {
          const four = [...m.a, ...m.b];
          if (four.some((p) => firstGame.has(p))) {
            // a beginner's first game is with beginners only if there are enough; never with an advanced player when avoidable
            const newcomers = four.filter((p) => firstGame.has(p));
            if (newcomers.every((p) => levels[p] === 4)) expect(four.some((p) => levels[p] === 2)).toBe(false);
          }
        }
      }
    }
  });

  it("with mixed pairs too, first games stay on one side of the beginner line", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { players, levels } = mixedRoster(seed);
      const genders = Object.fromEntries(players.map((p, i) => [p, i % 2 ? "woman" : "man"] as const));
      const night = playNight(mexicano.planRound, { players, courts: 2, rounds: 5, seed, levels, groupByLevel: true, genders, mixedPairs: true });
      for (const { plan, firstGame } of night) {
        for (const m of plan.matches) {
          const four = [...m.a, ...m.b];
          if (four.some((p) => firstGame.has(p))) expect(mixesBeginners(four, levels)).toBe(false);
        }
      }
      expect(byeSpread(night, players)).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  it("the sitting list is in roster order, so it can't hint at levels", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { players, levels } = mixedRoster(seed);
      const plan = mexicano.planRound({ ...ctxOf(players, 2, [], [], seed), levels, groupByLevel: true });
      expect(plan.byes).toEqual(players.filter((p) => plan.byes.includes(p)));
    }
  });

  it("once everyone has results, the toggle changes nothing", () => {
    const players = names(10);
    const levels = { p1: 2, p2: 4, p3: 2, p4: 4, p5: 3, p6: 4, p7: 3, p8: 2, p9: 2, p10: 3 };
    const history: HistoryRound[] = [
      { number: 1, byes: ["p9", "p10"], matches: [{ a: ["p1", "p2"], b: ["p3", "p4"] }, { a: ["p5", "p6"], b: ["p7", "p8"] }] },
      { number: 2, byes: ["p1", "p2"], matches: [{ a: ["p3", "p9"], b: ["p4", "p10"] }, { a: ["p5", "p7"], b: ["p6", "p8"] }] },
    ];
    const standings = ladder(players);
    for (let seed = 1; seed <= 20; seed++) {
      const off = mexicano.planRound(ctxOf(players, 2, history, standings, seed));
      const on = mexicano.planRound({ ...ctxOf(players, 2, history, standings, seed), levels, groupByLevel: true });
      expect(on.matches).toEqual(off.matches);
      expect(new Set(on.byes)).toEqual(new Set(off.byes)); // grouped sit-outs are listed in roster order
    }
  });
});

describe("late arrivals", () => {
  // Rounds a latecomer missed count as their share of sit-outs (engine.ts), so
  // they join the rotation instead of sitting until their count catches up.
  it("someone arriving at round 9 of an 18-player, 2-court night sits at most once before playing, then plays their share", () => {
    for (const groupByLevel of [false, true]) {
      for (let seed = 1; seed <= 30; seed++) {
        const { players, levels } = mixedRoster(seed);
        const night = playNight(mexicano.planRound, {
          players: [...players, "late"],
          courts: 2,
          rounds: 18,
          seed,
          levels: { ...levels, late: 2 },
          groupByLevel,
          arrivals: { late: 9 },
        });
        const after = night.slice(8);
        const firstGame = after.findIndex(({ plan }) => plan.matches.some((m) => [...m.a, ...m.b].includes("late")));
        expect(firstGame).toBeGreaterThanOrEqual(0);
        expect(firstGame).toBeLessThanOrEqual(1);
        const games = (id: string) => after.filter(({ plan }) => plan.matches.some((m) => [...m.a, ...m.b].includes(id))).length;
        const others = players.map(games);
        expect(games("late")).toBeGreaterThanOrEqual(Math.min(...others));
        expect(games("late")).toBeLessThanOrEqual(Math.max(...others));
      }
    }
  }, 60_000);

  it("credits add up exactly: three thirds of a sit-out equal one real sit-out", () => {
    const twelve = names(12);
    const rounds: HistoryRound[] = [1, 2, 3].map((number) => ({
      number,
      byes: twelve.slice(0, 4),
      matches: [{ a: [twelve[4], twelve[5]], b: [twelve[6], twelve[7]] }, { a: [twelve[8], twelve[9]], b: [twelve[10], twelve[11]] }],
    }));
    expect(creditAbsences(buildHistory(rounds), rounds, [...twelve, "late"]).byeCounts.late).toBe(1);
  });

  it("someone arriving at round 4 of 12 on 2 courts never sits two rounds running", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = names(12);
      const night = playNight(mexicano.planRound, { players: [...players, "late"], courts: 2, rounds: 12, seed, arrivals: { late: 4 } });
      const sat = night.slice(3).map(({ plan }) => plan.byes.includes("late"));
      expect(sat.some((s, i) => s && sat[i + 1])).toBe(false);
    }
  });

  it("a night where everyone is there from round 1 is unchanged by the credit", () => {
    const players = names(10);
    const history: HistoryRound[] = [{ number: 1, byes: ["p9", "p10"], matches: [{ a: ["p1", "p2"], b: ["p3", "p4"] }, { a: ["p5", "p6"], b: ["p7", "p8"] }] }];
    const h = buildHistory(history);
    expect(creditAbsences(buildHistory(history), history, players)).toEqual(h);
  });
});

describe("court ranking", () => {
  it("ranks by points per match played so a sit-out doesn't drop you a court", async () => {
    const { rankForCourts } = await import("../src/shared/standings");
    const rows = [
      { name: "two matches", points: 28, diff: 4, played: 2 }, // 14.0 avg
      { name: "sat out once", points: 20, diff: 16, played: 1 }, // 20.0 avg
      { name: "no result", points: 0, diff: 0, played: 0 },
    ];
    expect(rankForCourts(rows).map((r) => r.name)).toEqual(["sat out once", "two matches", "no result"]);
  });
});

describe("mexicano mixed pairs", () => {
  const genders = { w1: "woman", w2: "woman", w3: "woman", w4: "woman", m1: "man", m2: "man", m3: "man", m4: "man" } as const;
  it("deals court 1 the top two women and top two men, teams mixed", () => {
    const players = ["w1", "m1", "w2", "m2", "w3", "m3", "w4", "m4"]; // standings order
    const plan = mexicano.planRound({ ...ctxOf(players, 2, [], ladder(players)), genders, mixedPairs: true });
    const c1 = courtOf(plan, 1);
    expect(new Set([...c1.a, ...c1.b])).toEqual(new Set(["w1", "w2", "m1", "m2"]));
    // best woman + second man vs second woman + best man
    expect(new Set([team(c1.a), team(c1.b)])).toEqual(new Set(["m2+w1", "m1+w2"]));
    const c2 = courtOf(plan, 2);
    expect(new Set([...c2.a, ...c2.b])).toEqual(new Set(["w3", "w4", "m3", "m4"]));
  });
});

describe("night recommendation", () => {
  it("picks 16 points for a 90-minute booking and 24 for two hours", async () => {
    const { recommendSetup } = await import("../src/shared/timing");
    expect(recommendSetup(12, 3, 90)).toEqual({ courts: 3, points: 16, rounds: 7 });
    expect(recommendSetup(12, 3, 120)).toEqual({ courts: 3, points: 24, rounds: 7 });
    expect(recommendSetup(12, 3, 60)?.points).toBe(12);
    expect(recommendSetup(20, 3, 90)?.courts).toBe(3);
    expect(recommendSetup(6, 3, 90)?.courts).toBe(1);
    expect(recommendSetup(3, 3, 90)).toBeNull();
    // socialising: ~30% sit each round, never more than 40%
    expect(recommendSetup(12, 3, 90, "social")?.courts).toBe(2); // 4 of 12 sit
    expect(recommendSetup(14, 3, 90, "social")?.courts).toBe(3); // 2 courts would bench 6 of 14
    expect(recommendSetup(16, 4, 90, "social")?.courts).toBe(3); // 4 of 16 sit
    expect(recommendSetup(8, 2, 90, "social")?.courts).toBe(2); // 1 court would bench half
  });
});
