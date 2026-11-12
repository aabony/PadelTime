import { describe, expect, it } from "vitest";
import { TEST_BATCH, TEST_PLAYERS, isTestPlayerName, nextTestPlayers } from "../src/shared/testPlayers";

const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

describe("test players", () => {
  it("sixteen distinct stand-ins, each marked as a test", () => {
    expect(TEST_PLAYERS).toHaveLength(16);
    expect(new Set(TEST_PLAYERS.map((p) => p.name)).size).toBe(16);
    expect(TEST_PLAYERS.every((p) => isTestPlayerName(p.name))).toBe(true);
  });

  it("the first tap's twelve are balanced: 6 women, 6 men, three at each level", () => {
    const first = nextTestPlayers([]);
    expect(first).toHaveLength(TEST_BATCH);
    expect(count(first, (p) => p.gender === "woman")).toBe(6);
    expect(count(first, (p) => p.gender === "man")).toBe(6);
    for (const level of [1, 2, 3, 4]) expect(count(first, (p) => p.level === level)).toBe(3);
  });

  it("all sixteen are balanced too", () => {
    expect(count(TEST_PLAYERS, (p) => p.gender === "woman")).toBe(8);
    for (const level of [1, 2, 3, 4]) expect(count(TEST_PLAYERS, (p) => p.level === level)).toBe(4);
  });

  it("a second tap adds the ones not on the roster yet, then there are none left", () => {
    const first = nextTestPlayers([]).map((p) => p.name);
    const second = nextTestPlayers(first);
    expect(second).toHaveLength(4);
    expect(second.some((p) => first.includes(p.name))).toBe(false);
    expect(nextTestPlayers([...first, ...second.map((p) => p.name)])).toHaveLength(0);
  });

  it("someone removed from the roster can be added again; real names don't count", () => {
    const roster = ["Ana (test)", "ben (TEST)", "Carla", null, undefined];
    const next = nextTestPlayers(roster, 3).map((p) => p.name);
    expect(next).toEqual(["Carla (test)", "Dan (test)", "Elena (test)"]);
  });

  it("only names carrying the marker are stand-ins", () => {
    expect(isTestPlayerName("Ana (test)")).toBe(true);
    expect(isTestPlayerName("Ana (Test) ")).toBe(true);
    expect(isTestPlayerName("Ana")).toBe(false);
    expect(isTestPlayerName("Tester Ana")).toBe(false);
    expect(isTestPlayerName(null)).toBe(false);
  });
});
