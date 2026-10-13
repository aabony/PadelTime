import { describe, expect, it } from "vitest";
import { isBeginner, levelMeta, normalizeLevel, parseLevel } from "../src/shared/levels";

describe("playing levels", () => {
  it("parses the three levels from the wire", () => {
    expect(parseLevel(2)).toBe(2);
    expect(parseLevel("3")).toBe(3);
    expect(parseLevel(4)).toBe(4);
  });

  it("reads the old 'Newbie' value 1 as Beginner", () => {
    expect(parseLevel(1)).toBe(2);
    expect(normalizeLevel(1)).toBe(2);
    expect(levelMeta(1)?.label).toBe("Beginner");
    expect(isBeginner(1)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const v of [0, 5, 2.5, -1, "x", "", null, undefined, {}]) expect(parseLevel(v)).toBeNull();
    expect(levelMeta(null)).toBeNull();
    expect(levelMeta(9)).toBeNull();
  });

  it("labels each level", () => {
    expect([2, 3, 4].map((v) => levelMeta(v)?.label)).toEqual(["Beginner", "Intermediate", "Advanced"]);
    expect(isBeginner(3)).toBe(false);
    expect(isBeginner(null)).toBe(false);
  });
});
