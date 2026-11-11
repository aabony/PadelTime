import { describe, expect, it } from "vitest";
import { americano } from "../src/shared/formats/americano";
import { mexicano } from "../src/shared/formats/mexicano";
import {
  beginnerCourtOf,
  coachedActive,
  ladderCourts,
  planBeginnerGame,
  planCoached,
  poolOfCourt,
  poolOfMatch,
  poolRounds,
  poolsActive,
} from "../src/shared/formats/pools";
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
  it("needs the toggle, two courts, four newbies and eight players", () => {
    expect(poolsActive({ beginnerCourt: true, courts: 3, eligible: 14, newbies: 6 })).toBe(true);
    expect(poolsActive({ beginnerCourt: true, courts: 2, eligible: 8, newbies: 4 })).toBe(true);
    expect(poolsActive({ beginnerCourt: false, courts: 3, eligible: 14, newbies: 6 })).toBe(false);
    expect(poolsActive({ beginnerCourt: true, courts: 1, eligible: 14, newbies: 6 })).toBe(false);
    expect(poolsActive({ beginnerCourt: true, courts: 3, eligible: 14, newbies: 0 })).toBe(false);
    // A game takes four: three newbies play the main draw until a fourth arrives.
    expect(poolsActive({ beginnerCourt: true, courts: 3, eligible: 14, newbies: 3 })).toBe(false);
    expect(poolsActive({ beginnerCourt: true, courts: 2, eligible: 7, newbies: 4 })).toBe(false);
    expect(poolsActive({ beginnerCourt: true, fixedTeams: true, courts: 3, eligible: 14, newbies: 6 })).toBe(false);
  });
});

describe("the main rounds with the beginner court set aside", () => {
  it("deal the ladder on the other courts and never touch the newbies or their court", () => {
    const players = names(14);
    const newbies = ["p9", "p10", "p11", "p12", "p13", "p14"];
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planCoached(ctxOf(players, 3, [], ladder(names(8)), seed), mexicano, newbies);
      // The ladder's 8 fill courts 2 and 3; court 1 is the beginners'.
      expect(plan.matches.map((m) => m.court).sort()).toEqual([2, 3]);
      const dealt = plan.matches.flatMap((m) => [...m.a, ...m.b]);
      expect(dealt.some((id) => newbies.includes(id))).toBe(false);
      expect(plan.byes).toHaveLength(0);
    }
  });

  it("Mexicano's top four land on the first ladder court", () => {
    const plan = planCoached(ctxOf(names(16), 4, [], ladder(names(12)), 3), mexicano, ["p13", "p14", "p15", "p16"]);
    expect(plan.matches.map((m) => m.court).sort()).toEqual([2, 3, 4]);
    expect(onCourt(plan, 2).sort()).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("rotate the ladder's sit-outs fairly over a night", () => {
    const players = names(22);
    const newbies = players.slice(14); // 14 ladder players on 2 of 3 courts: 6 sit each round
    const night = playNight((ctx) => planCoached(ctx, mexicano, newbies), { players, courts: 3, rounds: 7, seed: 11, ladderOnly: true });
    const sat = players.slice(0, 14).map((id) => night.filter((r) => r.plan.byes.includes(id)).length);
    expect(Math.max(...sat) - Math.min(...sat)).toBeLessThanOrEqual(1);
    for (const r of night) {
      expect(r.plan.matches.some((m) => m.court === 1)).toBe(false);
      expect([...r.plan.byes, ...r.plan.matches.flatMap((m) => [...m.a, ...m.b])].some((id) => newbies.includes(id))).toBe(false);
    }
  });
});

describe("the beginner court's own games", () => {
  it("deal four newbies onto the beginner court and sit the rest", () => {
    const newbies = names(6);
    for (let seed = 1; seed <= 10; seed++) {
      const plan = planBeginnerGame(ctxOf(newbies, 1, [], [], seed), 3);
      expect(plan.matches).toHaveLength(1);
      expect(plan.matches[0].court).toBe(3);
      expect(new Set([...plan.matches[0].a, ...plan.matches[0].b]).size).toBe(4);
      expect(plan.byes).toHaveLength(2);
    }
  });

  it("with exactly four, everyone plays every game and partners rotate", () => {
    const night = playNight((ctx) => planBeginnerGame(ctx), { players: names(4), courts: 1, rounds: 3, seed: 5 });
    const partners = new Set(night.map((r) => [r.plan.matches[0].a[0], r.plan.matches[0].a[1]].sort().join("+") + "|" + [r.plan.matches[0].b[0], r.plan.matches[0].b[1]].sort().join("+")));
    expect(night.every((r) => r.plan.byes.length === 0)).toBe(true);
    expect(partners.size).toBe(3); // the three ways to pair four players, each once
  });

  it("share the sit-outs fairly over a run of games", () => {
    const newbies = names(7);
    const night = playNight((ctx) => planBeginnerGame(ctx), { players: newbies, courts: 1, rounds: 14, seed: 9 });
    const sat = newbies.map((id) => night.filter((r) => r.plan.byes.includes(id)).length);
    expect(Math.max(...sat) - Math.min(...sat)).toBeLessThanOrEqual(1);
  });

  it("ignore the ladder's standings, levels and who's busy on other courts", () => {
    const ctx = { ...ctxOf(names(5), 1, [], ladder(names(5)), 4), levels: { p1: 4, p2: 4, p3: 2, p4: 2, p5: 2 }, groupByLevel: true, busy: ["p1", "p2"] };
    const plan = planBeginnerGame(ctx);
    expect(plan.matches).toHaveLength(1);
    expect(plan.byes).toHaveLength(1);
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

describe("rounds know which sequence they belong to", () => {
  const m = (court: number) => ({ court });
  it("a beginner-track game is the beginners' and a main round the ladder's, whatever the court", () => {
    expect(poolOfMatch({ track: "beginner" }, m(2), 1)).toBe("beginner");
    expect(poolOfMatch({ track: "main" }, m(1), 1)).toBe("ladder");
  });
  it("rounds dealt before the tracks existed are split by court", () => {
    expect(poolOfMatch({}, m(1), 1)).toBe("beginner");
    expect(poolOfMatch({ track: null }, m(2), 1)).toBe("ladder");
    expect(poolOfMatch({}, m(3), 3)).toBe("beginner");
  });
  it("poolRounds keeps each track whole", () => {
    const round = (track: RoundRow["track"], courts: number[]): RoundRow => ({
      id: `${track}`,
      number: 1,
      createdAt: 1,
      byes: [],
      complete: true,
      track,
      matches: courts.map((court, i) => ({ id: `${track}${i}`, roundId: `${track}`, court, a: ["a", "b"], b: ["c", "d"], scoreA: 9, scoreB: 7, status: "confirmed", submittedBy: null })),
    });
    const all = [round("main", [1, 2, 3]), round("beginner", [1])];
    expect(poolRounds(all, "ladder", 1).map((r) => r.matches.length)).toEqual([3, 0]);
    expect(poolRounds(all, "beginner", 1).map((r) => r.matches.length)).toEqual([0, 1]);
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

  it("applies to the ladder with the beginner court set aside", () => {
    const players = names(12);
    const newbies = ["p9", "p10", "p11", "p12"];
    const night = playNight((ctx) => planCoached(ctx, mexicano, newbies), {
      players,
      courts: 2,
      rounds: 8,
      seed: 4,
      competitive: true,
      ladderOnly: true,
      levels: Object.fromEntries(players.map((p, i) => [p, i < 4 ? 4 : i < 8 ? 2 : 3])),
    });
    // The newbies are on their own court's clock: never in a main round, playing or sitting.
    for (const r of night) expect([...r.plan.byes, ...r.plan.matches.flatMap((m) => [...m.a, ...m.b])].some((p) => newbies.includes(p))).toBe(false);
    // Ladder: from round 4 (everyone has 3 games) the four sitting are the bottom four by average; the
    // level-2 players (p5..p8) lose most games to the level-4s, so they sit far more in the later rounds.
    const late = night.slice(3);
    const sits = (ids: string[]) => late.reduce((n, r) => n + r.plan.byes.filter((p) => ids.includes(p)).length, 0);
    expect(sits(["p5", "p6", "p7", "p8"])).toBeGreaterThan(sits(["p1", "p2", "p3", "p4"]));
  });
});

describe("a beginner court other than court 1", () => {
  it("the main rounds deal around the chosen court, and the beginners' game lands on it", () => {
    const players = names(16);
    const newbies = ["p13", "p14", "p15", "p16"];
    for (let seed = 1; seed <= 10; seed++) {
      const main = planCoached(ctxOf(players, 4, [], ladder(names(12)), seed), mexicano, newbies, 3);
      expect(main.matches.map((m) => m.court).sort()).toEqual([1, 2, 4]);
      // Mexicano's top four land on the first ladder court, which is now court 1.
      expect(onCourt(main, 1).sort()).toEqual(["p1", "p2", "p3", "p4"]);
      const game = planBeginnerGame(ctxOf(newbies, 1, [], [], seed), 3);
      expect(onCourt(game, 3).sort()).toEqual([...newbies].sort());
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

describe("coached court", () => {
  it("is on whenever the court is set to coaching (no minimum players), but never with fixed teams or one court", () => {
    expect(coachedActive({ beginnerCourt: true, coached: true, courts: 4 })).toBe(true);
    expect(coachedActive({ beginnerCourt: true, coached: false, courts: 4 })).toBe(false);
    expect(coachedActive({ beginnerCourt: false, coached: true, courts: 4 })).toBe(false);
    expect(coachedActive({ beginnerCourt: true, coached: true, courts: 1 })).toBe(false);
    expect(coachedActive({ beginnerCourt: true, coached: true, fixedTeams: true, courts: 4 })).toBe(false);
  });

  it("leaves the newbies out of the draw and nobody on the coached court", () => {
    const players = names(15);
    const newbies = ["p13", "p14", "p15"];
    for (let seed = 1; seed <= 10; seed++) {
      const plan = planCoached(ctxOf(players, 4, [], ladder(names(12)), seed), mexicano, newbies, 4);
      // 12 in the tournament on courts 1–3; court 4 is the coach's.
      expect(plan.matches.map((m) => m.court).sort()).toEqual([1, 2, 3]);
      const dealt = plan.matches.flatMap((m) => [...m.a, ...m.b]);
      expect(dealt).toHaveLength(12);
      expect(dealt.some((id) => newbies.includes(id))).toBe(false);
      expect(plan.byes.some((id) => newbies.includes(id))).toBe(false);
      expect(plan.byes).toHaveLength(0);
    }
  });

  it("deals around a coached court in the middle, and sits only tournament players", () => {
    const players = names(12);
    const newbies = ["p11", "p12"];
    const plan = planCoached(ctxOf(players, 3, [], ladder(names(10)), 2), americano, newbies, 2);
    expect(plan.matches.map((m) => m.court).sort()).toEqual([1, 3]);
    expect(plan.byes).toHaveLength(2);
    expect(plan.byes.every((id) => !newbies.includes(id))).toBe(true);
  });
});
