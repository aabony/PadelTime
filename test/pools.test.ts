import { describe, expect, it } from "vitest";
import { americano } from "../src/shared/formats/americano";
import { mexicano } from "../src/shared/formats/mexicano";
import { BEGINNER_COURT, beginnerCourtOf, ladderCourts, planWithPools, poolOfCourt, poolRounds, poolsActive } from "../src/shared/formats/pools";
import { COMPETITIVE_FLOOR, pickByes } from "../src/shared/formats/byes";
import { mulberry32 } from "../src/shared/formats/types";
import type { EngineContext } from "../src/shared/formats/types";
import { buildHistory } from "../src/shared/history";
import type { HistoryRound } from "../src/shared/history";
import { computeStandings } from "../src/shared/standings";
import type { RoundRow } from "../src/shared/types";
import { playNight } from "./helpers/night";

const names = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

function ctxOf(players: string[], courts: number, history: HistoryRound[] = [], standings: EngineContext["standings"] = [], seed = 7): EngineContext {
  return { players, courts, roundNumber: history.length + 1, ...buildHistory(history), standings, rng: mulberry32(seed) };
}
const onCourt = (plan: { matches: { court: number; a: [string, string]; b: [string, string] }[] }, court: number) => {
  const m = plan.matches.find((x) => x.court === court);
  return m ? [...m.a, ...m.b] : [];
};
/** Standings best first: p1 strongest, descending. */
const ladder = (ids: string[]) => ids.map((playerId, i) => ({ playerId, points: 100 - i * 5, played: 2 }));

describe("poolsActive", () => {
  it("needs the toggle, two courts, a newbie and eight players", () => {
    expect(poolsActive({ beginnerCourt: true, courts: 3, eligible: 14, newbies: 6 })).toBe(true);
    expect(poolsActive({ beginnerCourt: false, courts: 3, eligible: 14, newbies: 6 })).toBe(false);
    expect(poolsActive({ beginnerCourt: true, courts: 1, eligible: 14, newbies: 6 })).toBe(false);
    expect(poolsActive({ beginnerCourt: true, courts: 3, eligible: 14, newbies: 0 })).toBe(false);
    expect(poolsActive({ beginnerCourt: true, courts: 2, eligible: 7, newbies: 3 })).toBe(false);
    expect(poolsActive({ beginnerCourt: true, fixedTeams: true, courts: 3, eligible: 14, newbies: 6 })).toBe(false);
  });
});

describe("planWithPools", () => {
  it("puts only newbies on court 1 and nobody tagged on the ladder courts", () => {
    const players = names(14);
    const newbies = ["p9", "p10", "p11", "p12", "p13", "p14"];
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planWithPools(ctxOf(players, 3, [], ladder(names(8)), seed), mexicano, newbies);
      expect(plan.matches).toHaveLength(3);
      const court1 = onCourt(plan, BEGINNER_COURT);
      expect(court1).toHaveLength(4);
      expect(court1.every((p) => newbies.includes(p))).toBe(true);
      for (const c of [2, 3]) expect(onCourt(plan, c).some((p) => newbies.includes(p))).toBe(false);
      // 14 players on 3 courts: two sit — both newbies (the ladder's 8 fill 2 courts exactly).
      expect(plan.byes).toHaveLength(2);
      expect(plan.byes.every((p) => newbies.includes(p))).toBe(true);
    }
  });

  it("ladder courts are the format's courts shifted up by one", () => {
    const players = names(16);
    const newbies = ["p13", "p14", "p15", "p16"];
    const plan = planWithPools(ctxOf(players, 4, [], ladder(names(12)), 3), mexicano, newbies);
    expect(plan.matches.map((m) => m.court).sort()).toEqual([1, 2, 3, 4]);
    // Mexicano's top four (p1..p4) land on the first ladder court, which is court 2.
    expect(onCourt(plan, 2).sort()).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("tops court 1 up from the bottom of the ladder when newbies are short", () => {
    const players = names(12);
    const plan = planWithPools(ctxOf(players, 3, [], ladder(names(10)), 5), mexicano, ["p11", "p12"]);
    const court1 = onCourt(plan, 1);
    expect(court1).toContain("p11");
    expect(court1).toContain("p12");
    // p9 and p10 are the lowest ranked ladder players.
    expect(court1.sort()).toEqual(["p10", "p11", "p12", "p9"]);
    expect(onCourt(plan, 2).sort()).toEqual(["p1", "p2", "p3", "p4"]);
    expect(plan.byes).toHaveLength(0);
  });

  it("never tops up with a player still finishing a game", () => {
    const players = names(12);
    const ctx = { ...ctxOf(players, 3, [], ladder(names(10)), 5), busy: ["p9", "p10"] };
    const plan = planWithPools(ctx, mexicano, ["p11", "p12"]);
    expect(onCourt(plan, 1).sort()).toEqual(["p11", "p12", "p7", "p8"]);
  });

  it("rotates sit-outs fairly inside each pool over a night", () => {
    const players = names(22);
    const newbies = names(22).slice(14); // 8 newbies, 14 ladder on 3 courts
    const night = playNight((ctx) => planWithPools(ctx, mexicano, newbies), { players, courts: 3, rounds: 7, seed: 11, ladderOnly: true });
    const spread = (ids: string[]) => {
      const counts = ids.map((id) => night.filter((r) => r.plan.byes.includes(id)).length);
      return Math.max(...counts) - Math.min(...counts);
    };
    expect(spread(newbies)).toBeLessThanOrEqual(1);
    expect(spread(players.slice(0, 14))).toBeLessThanOrEqual(1);
    for (const r of night) {
      expect(onCourt(r.plan, 1).every((p) => newbies.includes(p))).toBe(true);
      for (const c of [2, 3]) expect(onCourt(r.plan, c).some((p) => newbies.includes(p))).toBe(false);
    }
  });

  it("works with Americano as the ladder format too", () => {
    const plan = planWithPools(ctxOf(names(12), 2, [], [], 2), americano, ["p9", "p10", "p11", "p12"]);
    expect(plan.matches.map((m) => m.court).sort()).toEqual([1, 2]);
    expect(onCourt(plan, 1).sort()).toEqual(["p10", "p11", "p12", "p9"]);
  });
});

describe("poolRounds and per-pool standings", () => {
  const round = (n: number, matches: { court: number; a: [string, string]; b: [string, string]; scoreA: number; scoreB: number }[]): RoundRow => ({
    id: `r${n}`,
    number: n,
    createdAt: n,
    byes: [],
    complete: true,
    matches: matches.map((m, i) => ({ id: `r${n}m${i}`, roundId: `r${n}`, status: "confirmed", submittedBy: null, ...m })),
  });
  const rounds = [
    round(1, [
      { court: 1, a: ["n1", "n2"], b: ["n3", "n4"], scoreA: 10, scoreB: 6 },
      { court: 2, a: ["l1", "l2"], b: ["l3", "l4"], scoreA: 9, scoreB: 7 },
    ]),
    round(2, [
      { court: 1, a: ["n1", "n3"], b: ["n2", "n4"], scoreA: 12, scoreB: 4 },
      { court: 2, a: ["l1", "l3"], b: ["l2", "l4"], scoreA: 8, scoreB: 8 },
    ]),
  ];
  const players = [..."1234"].flatMap((i) => [{ id: `n${i}`, name: `n${i}` }, { id: `l${i}`, name: `l${i}` }]);

  it("each table only counts its own court's matches", () => {
    const beginner = computeStandings(players.filter((p) => p.id.startsWith("n")), poolRounds(rounds, "beginner"));
    const ladderTable = computeStandings(players.filter((p) => p.id.startsWith("l")), poolRounds(rounds, "ladder"));
    expect(beginner[0]).toMatchObject({ playerId: "n1", points: 22, played: 2, ranked: true });
    expect(ladderTable[0]).toMatchObject({ playerId: "l1", points: 17, played: 2 });
    expect(ladderTable.every((r) => r.played === 2)).toBe(true);
  });
});

describe("competitive sit-outs", () => {
  const playedTwice: HistoryRound[] = [
    { number: 1, byes: [], matches: [{ a: ["p1", "p2"], b: ["p3", "p4"] }, { a: ["p5", "p6"], b: ["p7", "p8"] }] },
    { number: 2, byes: [], matches: [{ a: ["p1", "p3"], b: ["p2", "p4"] }, { a: ["p5", "p7"], b: ["p6", "p8"] }] },
  ];
  const standings = names(8).map((playerId, i) => ({ playerId, points: 40 - i * 3, played: 3 }));

  it("does nothing before everyone has reached the floor", () => {
    const ctx = { ...ctxOf(names(8), 1, playedTwice, standings), competitive: true };
    expect(ctx.playedCounts.p1).toBe(2);
    expect(COMPETITIVE_FLOOR).toBe(3);
    // Fair rotation: nobody has sat, so the pick is random — but it is not forced to be the bottom four.
    const picks = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const c = { ...ctx, rng: mulberry32(seed) };
      for (const p of pickByes(c, 4)) picks.add(p);
    }
    expect(picks.size).toBeGreaterThan(4);
  });

  it("benches the lowest averages once everyone has the floor", () => {
    const three: HistoryRound[] = [...playedTwice, { number: 3, byes: [], matches: [{ a: ["p1", "p4"], b: ["p2", "p3"] }, { a: ["p5", "p8"], b: ["p6", "p7"] }] }];
    const ctx = { ...ctxOf(names(8), 1, three, standings), competitive: true };
    expect(pickByes(ctx, 4).sort()).toEqual(["p5", "p6", "p7", "p8"]);
    // Off: fairness decides, so the pick spreads.
    const fair = { ...ctx, competitive: false };
    const picks = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) for (const p of pickByes({ ...fair, rng: mulberry32(seed) }, 4)) picks.add(p);
    expect(picks.size).toBeGreaterThan(4);
  });

  it("applies inside each pool with the beginner court on", () => {
    const players = names(12);
    const newbies = ["p9", "p10", "p11", "p12"];
    const night = playNight((ctx) => planWithPools(ctx, mexicano, newbies), {
      players,
      courts: 2,
      rounds: 8,
      seed: 4,
      competitive: true,
      ladderOnly: true,
      levels: Object.fromEntries(players.map((p, i) => [p, i < 4 ? 4 : i < 8 ? 2 : 3])),
    });
    // Newbies always fill their court exactly (4 of 4), so they never sit.
    for (const r of night) expect(r.plan.byes.some((p) => newbies.includes(p))).toBe(false);
    // Ladder: from round 4 (everyone has 3 games) the four sitting are the bottom four by average; the
    // level-2 players (p5..p8) lose most games to the level-4s, so they sit far more in the later rounds.
    const late = night.slice(3);
    const sits = (ids: string[]) => late.reduce((n, r) => n + r.plan.byes.filter((p) => ids.includes(p)).length, 0);
    expect(sits(["p5", "p6", "p7", "p8"])).toBeGreaterThan(sits(["p1", "p2", "p3", "p4"]));
  });
});

describe("a beginner court other than court 1", () => {
  it("planWithPools puts the newbies on the chosen court and deals the ladder across the rest in order", () => {
    const players = names(16);
    const newbies = ["p13", "p14", "p15", "p16"];
    for (let seed = 1; seed <= 10; seed++) {
      const plan = planWithPools(ctxOf(players, 4, [], ladder(names(12)), seed), mexicano, newbies, 3);
      expect(plan.matches.map((m) => m.court).sort()).toEqual([1, 2, 3, 4]);
      expect(onCourt(plan, 3).every((p) => newbies.includes(p))).toBe(true);
      for (const c of [1, 2, 4]) expect(onCourt(plan, c).some((p) => newbies.includes(p))).toBe(false);
      // Mexicano's top four land on the first ladder court, which is now court 1.
      expect(onCourt(plan, 1).sort()).toEqual(["p1", "p2", "p3", "p4"]);
    }
  });

  it("poolRounds and poolOfCourt follow the chosen court", () => {
    expect(poolOfCourt(3, 3)).toBe("beginner");
    expect(poolOfCourt(1, 3)).toBe("ladder");
    expect(poolOfCourt(1)).toBe("beginner");
    expect(ladderCourts(4, 3)).toEqual([1, 2, 4]);
    expect(ladderCourts(3)).toEqual([2, 3]);
  });

  it("beginnerCourtOf keeps the choice inside the courts the session has", () => {
    expect(beginnerCourtOf({ beginnerCourtNo: 3, courts: 4 })).toBe(3);
    expect(beginnerCourtOf({ beginnerCourtNo: 4, courts: 2 })).toBe(2);
    expect(beginnerCourtOf({ beginnerCourtNo: null, courts: 3 })).toBe(1);
    expect(beginnerCourtOf({ beginnerCourtNo: 0, courts: 3 })).toBe(1);
  });
});
