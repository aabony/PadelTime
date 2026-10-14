import { describe, expect, it } from "vitest";
import { computeWarnings } from "../src/worker/lib/detail";
import type { MatchRow, PlayerRow, RoundRow } from "../src/shared/types";

const player = (id: string): PlayerRow => ({ id, name: id, status: "checked_in" }) as PlayerRow;
const match = (a: [string, string], b: [string, string], status: MatchRow["status"] = "confirmed"): MatchRow =>
  ({ id: `${a}${b}`, roundId: "r", court: 1, a, b, scoreA: 10, scoreB: 6, status, submittedBy: null }) as MatchRow;
const round = (number: number, byes: string[], matches: MatchRow[]): RoundRow => ({ id: `r${number}`, number, createdAt: number, byes, matches, complete: true });

describe("organizer warnings", () => {
  it("a late arrival's share of sit-outs doesn't trigger a bogus 'has sat out' warning", () => {
    // f joined for round 2 and sat it out: a fair rotation (f's credited 1.2 vs b/c/d's 0
    // used to read "f has sat out 1 rounds; others only 0").
    const players = ["a", "b", "c", "d", "e", "f"].map(player);
    const rounds = [round(1, ["e"], [match(["a", "b"], ["c", "d"])]), round(2, ["a", "f"], [match(["b", "c"], ["d", "e"])])];
    expect(computeWarnings(players, rounds).filter((w) => w.includes("sat out"))).toEqual([]);
  });

  it("a disputed score is listed before partner repeats, which can't crowd it out", () => {
    const players = ["a", "b", "c", "d"].map(player);
    const rounds = Array.from({ length: 8 }, (_, i) =>
      round(i + 1, [], [match(["a", "b"], ["c", "d"], i === 7 ? "disputed" : "confirmed")]),
    );
    expect(computeWarnings(players, rounds)[0]).toBe("Court 1 score is disputed.");
  });
});
