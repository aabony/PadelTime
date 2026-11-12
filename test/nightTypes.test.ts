import { describe, expect, it } from "vitest";
import { NIGHT_TYPE_KEYS, flagsOf, nightTypeOf, NIGHT_TYPES } from "../src/shared/nightTypes";

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

describe("night type names", () => {
  it("lead with the padel format each one runs on", () => {
    expect(NIGHT_TYPES.social.name).toBe("Americano / Social");
    expect(NIGHT_TYPES.open.name).toBe("Mexicano / Open night");
    expect(NIGHT_TYPES.tournament.name).toBe("Mexicano / Tournament");
    for (const t of Object.values(NIGHT_TYPES)) expect(t.name.toLowerCase().startsWith(t.format)).toBe(true);
  });
});
