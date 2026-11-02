import { describe, expect, it } from "vitest";
import { NIGHT_TYPE_KEYS, flagsOf, nightTypeOf } from "../src/shared/nightTypes";

describe("night types", () => {
  it("every type round-trips through its switches", () => {
    for (const key of NIGHT_TYPE_KEYS) expect(nightTypeOf(flagsOf(key))).toBe(key);
  });
  it("switches that match no type read as custom", () => {
    expect(nightTypeOf({ format: "americano", beginnerCourt: true, competitiveSitouts: false })).toBeNull();
    expect(nightTypeOf({ format: "mexicano", beginnerCourt: false, competitiveSitouts: false })).toBeNull();
  });
  it("open night is the ladder with the beginner court; tournament adds competitive sit-outs", () => {
    expect(flagsOf("open")).toEqual({ format: "mexicano", beginnerCourt: true, competitiveSitouts: false });
    expect(flagsOf("tournament")).toEqual({ format: "mexicano", beginnerCourt: true, competitiveSitouts: true });
    expect(flagsOf("social")).toEqual({ format: "americano", beginnerCourt: false, competitiveSitouts: false });
  });
});
