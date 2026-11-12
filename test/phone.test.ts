import { describe, expect, it } from "vitest";
import { COUNTRIES, DEFAULT_COUNTRY_CODE, formatPhone, isValidPhone, joinPhone, normalizePhone, phoneProblem, splitPhone } from "../src/shared/phone";
import { validateProfile, validateProfilePatch } from "../src/shared/profile";

describe("phone numbers default to the USA", () => {
  it("the country list starts on +1", () => {
    expect(DEFAULT_COUNTRY_CODE).toBe("1");
    expect(COUNTRIES[0].code).toBe("1");
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
  });

  it("a plain 10-digit number is a US number, however it's typed", () => {
    for (const typed of ["5129923681", "512 992 3681", "(512) 992-3681", "512.992.3681"]) expect(normalizePhone(typed)).toBe("+15129923681");
    expect(joinPhone("1", "(512) 992-3681")).toBe("+15129923681");
  });

  it("an international number keeps its own code", () => {
    expect(normalizePhone("+34 600 123 456")).toBe("+34600123456");
    expect(joinPhone("34", "600 123 456")).toBe("+34600123456");
    expect(joinPhone("1", "")).toBe("");
  });

  it("splits a stored number back into code and number, longest code first", () => {
    expect(splitPhone("+15129923681")).toEqual({ code: "1", national: "5129923681" });
    expect(splitPhone("+34600123456")).toEqual({ code: "34", national: "600123456" });
    expect(splitPhone("+351912345678")).toEqual({ code: "351", national: "912345678" });
    // Saved before the country code existed: 10 bare digits read as a US number.
    expect(splitPhone("5129923681")).toEqual({ code: "1", national: "5129923681" });
    // A country we don't list keeps its code with the number, so re-saving loses nothing.
    expect(splitPhone("+998901234567")).toEqual({ code: "", national: "998901234567" });
    expect(joinPhone("", "+998 90 123 45 67")).toBe("+998901234567");
    expect(splitPhone(null)).toEqual({ code: "1", national: "" });
  });

  it("a US number must be exactly 10 digits with a real area code", () => {
    expect(isValidPhone("+15129923681")).toBe(true);
    expect(phoneProblem("+1512992368")).toMatch(/10 digits/);
    expect(phoneProblem("+151299236811")).toMatch(/10 digits/);
    expect(phoneProblem("+10129923681")).toMatch(/area code/);
    expect(phoneProblem("+11129923681")).toMatch(/area code/);
  });

  it("other countries need a plausible length", () => {
    expect(isValidPhone("+34600123456")).toBe(true);
    expect(isValidPhone("+3412")).toBe(false);
    expect(isValidPhone("12345")).toBe(false);
  });

  it("reads back nicely", () => {
    expect(formatPhone("+15129923681")).toBe("+1 (512) 992-3681");
    expect(formatPhone("5129923681")).toBe("+1 (512) 992-3681");
    expect(formatPhone("+34600123456")).toBe("+34600123456");
    expect(formatPhone(null)).toBe("");
  });

  it("the profile forms store the international form and explain a short US number", () => {
    const base = { firstName: "A", lastName: "B", dob: "1990-05-04", gender: "man", level: 3 };
    const today = new Date(Date.UTC(2026, 10, 12));
    const ok = validateProfile({ ...base, phone: "512 992 3681" }, today);
    expect(ok.ok && ok.profile.phone).toBe("+15129923681");
    const short = validateProfile({ ...base, phone: "+1512992" }, today);
    expect(!short.ok && short.error).toMatch(/10 digits/);
    const patch = validateProfilePatch({ phone: "+1 (512) 992-3681" }, today);
    expect(patch.ok && patch.profile.phone).toBe("+15129923681");
  });
});
