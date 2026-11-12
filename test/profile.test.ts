import { describe, expect, it } from "vitest";
import {
  validateProfilePatch,
  missingProfileFields,
  namesFromLegacy,
  ageAt,
  displayName,
  isProfileComplete,
  isValidDob,
  normalizePhone,
  parsePlaytomicLevel,
  validateProfile,
} from "../src/shared/profile";

const today = new Date(Date.UTC(2026, 10, 1)); // 1 Nov 2026

const good = {
  firstName: "  Paula ",
  lastName: "García",
  phone: "+34 600 123 456",
  dob: "1990-05-04",
  gender: "woman",
  level: 3,
  playtomicLevel: "3.5",
};

describe("validateProfile", () => {
  it("accepts a full profile and tidies it", () => {
    const r = validateProfile(good, today);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile).toEqual({
      firstName: "Paula",
      lastName: "García",
      phone: "+34600123456",
      dob: "1990-05-04",
      gender: "woman",
      level: 3,
      playtomicLevel: 3.5,
    });
    expect(displayName(r.profile)).toBe("Paula García");
  });

  it("Playtomic level is optional", () => {
    const r = validateProfile({ ...good, playtomicLevel: "" }, today);
    expect(r.ok && r.profile.playtomicLevel).toBeNull();
    const r2 = validateProfile({ ...good, playtomicLevel: undefined }, today);
    expect(r2.ok && r2.profile.playtomicLevel).toBeNull();
  });

  it("rejects a missing or odd required field with a plain message", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...good, firstName: "" }, /first name/i],
      [{ ...good, lastName: "   " }, /last name/i],
      [{ ...good, phone: "" }, /phone/i],
      [{ ...good, phone: "12345" }, /phone/i],
      [{ ...good, dob: "" }, /date of birth/i],
      [{ ...good, dob: "2025-01-01" }, /date of birth/i], // too young
      [{ ...good, dob: "1990-02-30" }, /date of birth/i], // not a real date
      [{ ...good, gender: "other" }, /woman or man/i],
      [{ ...good, level: 9 }, /level/i],
      [{ ...good, playtomicLevel: "8" }, /playtomic/i],
      [{ ...good, playtomicLevel: "abc" }, /playtomic/i],
    ];
    for (const [input, msg] of cases) {
      const r = validateProfile(input, today);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(msg);
    }
  });

  it("reads levels sent as strings and accepts Newbie (1)", () => {
    expect(validateProfile({ ...good, level: "4" }, today).ok).toBe(true);
    const r = validateProfile({ ...good, level: 1 }, today);
    expect(r.ok && r.profile.level).toBe(1);
  });
});

describe("helpers", () => {
  it("normalizePhone keeps + and digits only", () => {
    expect(normalizePhone(" +34 (600) 123-456 ")).toBe("+34600123456");
    expect(normalizePhone("0044 7700 900123")).toBe("00447700900123");
    expect(normalizePhone(42)).toBe("");
  });

  it("ageAt and isValidDob", () => {
    expect(ageAt("1990-05-04", today)).toBe(36);
    expect(ageAt("2026-11-02", today)).toBe(-1);
    expect(ageAt("1990-11-01", today)).toBe(36); // birthday today
    expect(ageAt("1990-11-02", today)).toBe(35); // birthday tomorrow
    expect(isValidDob("1990-05-04", today)).toBe(true);
    expect(isValidDob("04/05/1990", today)).toBe(false);
    expect(isValidDob("1900-01-01", today)).toBe(false); // 126 years old
  });

  it("parsePlaytomicLevel rounds to one decimal and accepts a comma", () => {
    expect(parsePlaytomicLevel("4,25")).toBe(4.3);
    expect(parsePlaytomicLevel(2)).toBe(2);
    expect(parsePlaytomicLevel(0.4)).toBe("invalid");
    expect(parsePlaytomicLevel(null)).toBeNull();
  });

  it("missingProfileFields names what an older account still lacks", () => {
    const legacy = { firstName: null, lastName: null, phone: null, dob: null, gender: null, level: null, playtomicLevel: null };
    expect(missingProfileFields(legacy)).toEqual(["first name", "last name", "phone", "date of birth", "gender", "level"]);
    expect(missingProfileFields({ ...legacy, firstName: "David", lastName: "Gordon", level: 3 })).toEqual(["phone", "date of birth", "gender"]);
    expect(missingProfileFields({ firstName: "A", lastName: "B", phone: "+1234567", dob: "1990-01-01", gender: "man", level: 2, playtomicLevel: null })).toEqual([]);
  });

  it("namesFromLegacy starts the form from an older account's display name", () => {
    expect(namesFromLegacy("David", "daveg@example.com")).toEqual({ firstName: "David", lastName: "" });
    expect(namesFromLegacy("  David   Ian Gordon ", "daveg@example.com")).toEqual({ firstName: "David", lastName: "Ian Gordon" });
    // The stand-ins a brand-new account gets aren't names.
    expect(namesFromLegacy("", "daveg@example.com")).toEqual({ firstName: "", lastName: "" });
    expect(namesFromLegacy("DaveG", "daveg@example.com")).toEqual({ firstName: "", lastName: "" });
    expect(namesFromLegacy("daveg@example.com", "daveg@example.com")).toEqual({ firstName: "", lastName: "" });
    expect(namesFromLegacy(null, "daveg@example.com")).toEqual({ firstName: "", lastName: "" });
  });

  it("isProfileComplete needs every required field but not Playtomic", () => {
    const full = { firstName: "A", lastName: "B", phone: "+1234567", dob: "1990-01-01", gender: "man" as const, level: 2, playtomicLevel: null };
    expect(isProfileComplete(full)).toBe(true);
    expect(isProfileComplete({ ...full, phone: null })).toBe(false);
    expect(isProfileComplete({ ...full, level: null })).toBe(false);
  });
});

describe("validateProfilePatch (an admin editing a member)", () => {
  const today = new Date(Date.UTC(2026, 10, 12));
  it("accepts just the details the organizer knows and leaves the rest empty", () => {
    const r = validateProfilePatch({ firstName: " David ", phone: "+1 (305) 555-0100", level: "3" }, today);
    expect(r).toEqual({
      ok: true,
      profile: { firstName: "David", lastName: null, phone: "+13055550100", dob: null, gender: null, level: 3, playtomicLevel: null },
    });
  });
  it("an entirely empty form is fine: every field cleared", () => {
    const r = validateProfilePatch({ firstName: "", lastName: "", phone: "", dob: "", gender: null, level: null, playtomicLevel: "" }, today);
    expect(r.ok && Object.values(r.profile).every((v) => v === null)).toBe(true);
  });
  it("accepts a complete profile exactly as the player's own form would", () => {
    const full = { firstName: "Paula", lastName: "García", phone: "+34 600 123 456", dob: "1990-05-04", gender: "woman", level: 1, playtomicLevel: "2.5" };
    const r = validateProfilePatch(full, today);
    expect(r.ok && r.profile).toEqual({ firstName: "Paula", lastName: "García", phone: "+34600123456", dob: "1990-05-04", gender: "woman", level: 1, playtomicLevel: 2.5 });
  });
  it("still refuses a value that's given but wrong", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ phone: "12345" }, /phone/i],
      [{ phone: "call me" }, /phone/i],
      [{ dob: "1990-02-30" }, /date of birth/i],
      [{ dob: "2030-01-01" }, /date of birth/i],
      [{ gender: "other" }, /woman or man/i],
      [{ level: 9 }, /level/i],
      [{ playtomicLevel: "9" }, /playtomic/i],
    ];
    for (const [input, msg] of cases) {
      const r = validateProfilePatch(input, today);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(msg);
    }
  });
});
