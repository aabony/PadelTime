import { describe, expect, it } from "vitest";
import { courtLabel, fitCourtLabels, parseCourtLabels } from "../src/shared/courts";
import { computeWarnings } from "../src/worker/lib/detail";
import type { MatchRow, PlayerRow, RoundRow } from "../src/shared/types";

describe("rented court numbers", () => {
  it("reads '3, 4', '3 4' or a list", () => {
    expect(parseCourtLabels("3, 4")).toEqual(["3", "4"]);
    expect(parseCourtLabels(" 3  4 ")).toEqual(["3", "4"]);
    expect(parseCourtLabels(["7", " Centre "])).toEqual(["7", "Centre"]);
    expect(parseCourtLabels("")).toEqual([]);
    expect(parseCourtLabels(null)).toEqual([]);
  });

  it("shows the rented name, else the number", () => {
    expect(courtLabel(["3", "4"], 1)).toBe("3");
    expect(courtLabel(["3", "4"], 2)).toBe("4");
    expect(courtLabel([], 2)).toBe("2");
  });

  it("keeps names in step with the number of courts", () => {
    expect(fitCourtLabels(["3", "4"], 3)).toEqual(["3", "4", "5"]);
    expect(fitCourtLabels(["3", "4", "5"], 2)).toEqual(["3", "4"]);
    expect(fitCourtLabels(["Centre"], 2)).toEqual(["Centre", "2"]);
    expect(fitCourtLabels([], 2)).toEqual([]);
  });

  it("warnings name the rented court", () => {
    const players = ["a", "b", "c", "d"].map((id) => ({ id, name: id, status: "checked_in" }) as PlayerRow);
    const match = { id: "m", roundId: "r", court: 1, a: ["a", "b"], b: ["c", "d"], scoreA: 9, scoreB: 7, status: "disputed", submittedBy: null } as MatchRow;
    const round: RoundRow = { id: "r", number: 1, createdAt: 1, byes: [], matches: [match], complete: false };
    expect(computeWarnings(players, [round], false, ["3", "4"])[0]).toBe("Court 3 score is disputed.");
  });
});
