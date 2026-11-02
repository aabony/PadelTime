import { describe, expect, it } from "vitest";
import {
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

  it("reads levels sent as strings and accepts the legacy 1 as beginner", () => {
    expect(validateProfile({ ...good, level: "4" }, today).ok).toBe(true);
    const r = validateProfile({ ...good, level: 1 }, today);
    expect(r.ok && r.profile.level).toBe(2);
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

  it("isProfileComplete needs every required field but not Playtomic", () => {
    const full = { firstName: "A", lastName: "B", phone: "+1234567", dob: "1990-01-01", gender: "man" as const, level: 2, playtomicLevel: null };
    expect(isProfileComplete(full)).toBe(true);
    expect(isProfileComplete({ ...full, phone: null })).toBe(false);
    expect(isProfileComplete({ ...full, level: null })).toBe(false);
  });
});
