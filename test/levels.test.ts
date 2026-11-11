import { describe, expect, it } from "vitest";
import { LEVELS, isBeginner, isNewbie, levelMeta, normalizeLevel, parseLevel } from "../src/shared/levels";

describe("playing levels", () => {
  it("parses the four levels from the wire", () => {
    expect(parseLevel(1)).toBe(1);
    expect(parseLevel(2)).toBe(2);
    expect(parseLevel("3")).toBe(3);
    expect(parseLevel(4)).toBe(4);
  });

  it("Newbie is its own level, below Beginner, on the beginner side of the grouping line", () => {
    expect(normalizeLevel(1)).toBe(1);
    expect(levelMeta(1)?.label).toBe("Newbie");
    expect(LEVELS.map((l) => l.label)).toEqual(["Newbie", "Beginner", "Intermediate", "Advanced"]);
    expect(isNewbie(1)).toBe(true);
    expect(isNewbie(2)).toBe(false);
    expect(isNewbie(null)).toBe(false);
    expect(isBeginner(1)).toBe(true);
    expect(isBeginner(2)).toBe(true);
    expect(LEVELS.every((l) => l.blurb.length > 0)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const v of [0, 5, 2.5, -1, "x", "", null, undefined, {}]) expect(parseLevel(v)).toBeNull();
    expect(levelMeta(null)).toBeNull();
    expect(levelMeta(9)).toBeNull();
  });

  it("labels each level", () => {
    expect([1, 2, 3, 4].map((v) => levelMeta(v)?.label)).toEqual(["Newbie", "Beginner", "Intermediate", "Advanced"]);
    expect(isBeginner(3)).toBe(false);
    expect(isBeginner(null)).toBe(false);
  });
});
