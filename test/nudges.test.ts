import { describe, expect, it } from "vitest";
import { computeNudges } from "../src/shared/nudges";
import type { RoundRow } from "../src/shared/types";

const round = (n: number, ms: { court: number; a: [string, string]; b: [string, string]; scoreA: number; scoreB: number }[]): RoundRow => ({
  id: `r${n}`,
  number: n,
  createdAt: n,
  byes: [],
  complete: true,
  matches: ms.map((m, i) => ({ id: `r${n}m${i}`, roundId: `r${n}`, status: "confirmed", submittedBy: null, ...m })),
});
const players = (newbies: string[]) =>
  ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id, status: "checked_in", newbie: newbies.includes(id) }));

describe("nudges", () => {
  it("suggests moving up a newbie with three straight wins on court 1", () => {
    const rounds = [1, 2, 3].map((n) => round(n, [{ court: 1, a: ["a", "b"], b: ["c", "d"], scoreA: 10, scoreB: 6 }, { court: 2, a: ["e", "f"], b: ["g", "h"], scoreA: 9, scoreB: 7 }]));
    const nudges = computeNudges(players(["a", "b", "c", "d"]), rounds);
    expect(nudges.filter((n) => n.kind === "up").map((n) => n.playerId).sort()).toEqual(["a", "b"]);
    expect(nudges.find((n) => n.playerId === "a")?.reason).toMatch(/3 straight wins/);
  });

  it("suggests moving down a ladder player with no win after three ladder games", () => {
    const rounds = [1, 2, 3].map((n) => round(n, [{ court: 1, a: ["a", "b"], b: ["c", "d"], scoreA: 8, scoreB: 8 }, { court: 2, a: ["e", "f"], b: ["g", "h"], scoreA: 9, scoreB: 7 }]));
    const nudges = computeNudges(players(["a", "b", "c", "d"]), rounds);
    expect(nudges.filter((n) => n.kind === "down").map((n) => n.playerId).sort()).toEqual(["g", "h"]);
    expect(nudges.some((n) => n.kind === "up")).toBe(false);
  });

  it("a move clears the nudge and a loss breaks the streak", () => {
    const rounds = [
      ...[1, 2, 3].map((n) => round(n, [{ court: 1, a: ["a", "b"], b: ["c", "d"], scoreA: 10, scoreB: 6 }])),
      round(4, [{ court: 1, a: ["a", "c"], b: ["b", "d"], scoreA: 4, scoreB: 12 }]),
    ];
    // a lost round 4: streak broken. b won all four; once moved up (untagged) b is a ladder player with no ladder games.
    const nudges = computeNudges(players(["a", "c", "d"]), rounds);
    expect(nudges).toEqual([]);
    // Still tagged, b is still nudged.
    expect(computeNudges(players(["a", "b", "c", "d"]), rounds).map((n) => n.playerId)).toEqual(["b"]);
  });

  it("ignores players who aren't checked in", () => {
    const rounds = [1, 2, 3].map((n) => round(n, [{ court: 2, a: ["e", "f"], b: ["g", "h"], scoreA: 9, scoreB: 7 }]));
    const ps = players([]).map((p) => (p.id === "g" ? { ...p, status: "dropped" } : p));
    expect(computeNudges(ps, rounds).map((n) => n.playerId)).toEqual(["h"]);
  });
});
