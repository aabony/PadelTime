import { describe, expect, it } from "vitest";
import { computeStandings, computeTeamStandings, minGamesToRank } from "../src/shared/standings";
import type { MatchRow, RoundRow } from "../src/shared/types";

const players = (...ids: string[]) => ids.map((id) => ({ id, name: id }));
let n = 0;
const game = (a: [string, string], b: [string, string], scoreA: number, scoreB: number): MatchRow => ({
  id: `m${++n}`,
  roundId: "r",
  court: 1,
  a,
  b,
  scoreA,
  scoreB,
  status: "confirmed",
  submittedBy: null,
});
const round = (number: number, matches: MatchRow[], byes: string[] = []): RoundRow => ({
  id: `r${number}`,
  number,
  createdAt: number,
  byes,
  matches,
  complete: true,
});
const order = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("standings rank by total points", () => {
  it("needs half as many games as the busiest player, rounded up", () => {
    expect(minGamesToRank([{ played: 4 }, { played: 1 }])).toBe(2);
    expect(minGamesToRank([{ played: 5 }])).toBe(3);
    expect(minGamesToRank([{ played: 1 }])).toBe(1);
    expect(minGamesToRank([{ played: 0 }])).toBe(0);
    expect(minGamesToRank([])).toBe(0);
  });

  it("with equal games it's the same order as total points", () => {
    const rows = computeStandings(players("a", "b", "c", "d"), [
      round(1, [game(["a", "b"], ["c", "d"], 10, 6)]),
      round(2, [game(["a", "c"], ["b", "d"], 9, 7)]),
    ]);
    expect(order(rows)).toEqual(["a", "b", "c", "d"]); // 19, 17, 15, 13
    expect(rows.every((r) => r.ranked)).toBe(true);
  });

  it("ranks by total points, not points per game", () => {
    // x: 3 games, 30 points (10/game). y: 2 games, 24 points (12/game).
    const rows = computeStandings(players("x", "y", "p", "q", "r", "s"), [
      round(1, [game(["x", "y"], ["p", "q"], 12, 4)], ["r", "s"]),
      round(2, [game(["x", "r"], ["s", "p"], 8, 8)], ["y", "q"]),
      round(3, [game(["x", "q"], ["y", "s"], 10, 12)], ["p", "r"]),
    ]);
    const x = rows.find((r) => r.name === "x")!;
    const y = rows.find((r) => r.name === "y")!;
    expect(x.points).toBeGreaterThan(y.points);
    expect(y.points / y.played).toBeGreaterThan(x.points / x.played);
    expect(order(rows).indexOf("x")).toBeLessThan(order(rows).indexOf("y"));
  });

  it("someone who left after one big win keeps their score but can't top the table", () => {
    const rounds = [
      round(1, [game(["gone", "a"], ["b", "c"], 16, 0)]),
      round(2, [game(["a", "b"], ["c", "d"], 9, 7)], ["gone"]),
      round(3, [game(["a", "c"], ["b", "d"], 9, 7)]),
      round(4, [game(["a", "d"], ["b", "c"], 9, 7)]),
    ];
    const rows = computeStandings(players("gone", "a", "b", "c", "d"), rounds);
    const gone = rows.find((r) => r.name === "gone")!;
    expect(gone.points).toBe(16); // scores are kept
    expect(gone.ranked).toBe(false); // 1 game, busiest has 4 → needs 2
    expect(rows.indexOf(gone)).toBeGreaterThan(rows.findLastIndex((r) => r.ranked));
    expect(rows[0].name).toBe("a");
  });

  it("a late arrival with half the busiest player's games is ranked", () => {
    const rows = computeStandings(players("a", "b", "c", "late"), [
      round(1, [game(["a", "b"], ["c", "x"], 8, 8)]),
      round(2, [game(["a", "c"], ["b", "x"], 8, 8)]),
      round(3, [game(["a", "late"], ["b", "c"], 14, 2)]),
      round(4, [game(["late", "b"], ["a", "c"], 14, 2)]),
    ]);
    const late = rows.find((r) => r.name === "late")!;
    expect(late.played).toBe(2);
    expect(late.ranked).toBe(true);
    expect(rows.indexOf(late)).toBeLessThan(rows.findIndex((r) => !r.ranked) === -1 ? rows.length : rows.findIndex((r) => !r.ranked));
  });

  it("players with no games yet are unranked, at the bottom", () => {
    const rows = computeStandings(players("a", "b", "c", "d", "e"), [round(1, [game(["a", "b"], ["c", "d"], 2, 14)], ["e"])]);
    expect(rows.at(-1)!.name).toBe("e");
    expect(rows.at(-1)!.ranked).toBe(false);
    expect(order(rows).slice(0, 2).sort()).toEqual(["c", "d"]);
  });
});

describe("team standings (keep teams together)", () => {
  const people = [
    { id: "ana", name: "Ana", partnerId: "ben" },
    { id: "ben", name: "Ben", partnerId: "ana" },
    { id: "cat", name: "Cat", partnerId: "dan" },
    { id: "dan", name: "Dan", partnerId: "cat" },
    { id: "eve", name: "Eve", partnerId: "fay" },
    { id: "fay", name: "Fay", partnerId: "eve" },
  ];

  it("one row per team, named in roster order, with the team's points", () => {
    const rows = computeTeamStandings(people, [
      round(1, [game(["ben", "ana"], ["cat", "dan"], 10, 6)], ["eve", "fay"]),
      round(2, [game(["eve", "fay"], ["ana", "ben"], 9, 7)], ["cat", "dan"]),
    ]);
    expect(rows.map((r) => `${r.name} ${r.points}`)).toEqual(["Ana & Ben 17", "Eve & Fay 9", "Cat & Dan 6"]);
    const ab = rows[0];
    expect(ab.members).toEqual(["ana", "ben"]);
    expect([ab.played, ab.wins, ab.losses]).toEqual([2, 1, 1]);
    expect(rows.find((r) => r.name === "Eve & Fay")!.byes).toBe(1);
  });

  it("lists current pairs that haven't played yet, unranked", () => {
    const rows = computeTeamStandings(people, [round(1, [game(["ana", "ben"], ["cat", "dan"], 8, 8)], ["eve", "fay"])]);
    const ef = rows.find((r) => r.name === "Eve & Fay")!;
    expect([ef.played, ef.ranked]).toEqual([0, false]);
    expect(rows.at(-1)).toBe(ef);
  });

  it("a re-paired player appears with each partner they played with", () => {
    const repaired = people.map((p) =>
      p.id === "ana" ? { ...p, partnerId: "dan" } : p.id === "dan" ? { ...p, partnerId: "ana" } : p.id === "ben" || p.id === "cat" ? { ...p, partnerId: null } : p,
    );
    const rows = computeTeamStandings(repaired, [
      round(1, [game(["ana", "ben"], ["cat", "dan"], 10, 6)], ["eve", "fay"]),
      round(2, [game(["ana", "dan"], ["eve", "fay"], 8, 8)], ["ben", "cat"]),
    ]);
    expect(rows.map((r) => r.name).sort()).toEqual(["Ana & Ben", "Ana & Dan", "Cat & Dan", "Eve & Fay"]);
  });
});
