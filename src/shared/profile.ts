// The player profile: what we know about a person, collected once at
// registration and reused for every tournament they join. Validation lives
// here so the form and the API agree on what counts as complete.
import { parseGender } from "./genders";
import type { Gender } from "./genders";
import { parseLevel } from "./levels";
import { isValidPhone, normalizePhone, phoneProblem } from "./phone";

export { isValidPhone, normalizePhone };

export interface PlayerProfile {
  firstName: string;
  lastName: string;
  phone: string;
  /** ISO date, "YYYY-MM-DD". */
  dob: string;
  gender: Gender;
  /** Playing level on the app's 1–4 scale (newbie / beginner / intermediate / advanced). */
  level: number;
  /** Optional Playtomic level, 0.5 to 7.0 with one decimal. */
  playtomicLevel: number | null;
}

/** The profile as stored: every field may still be empty on an account that hasn't finished registering. */
export type StoredProfile = {
  [K in keyof PlayerProfile]: PlayerProfile[K] | null;
};

export const EMPTY_PROFILE: StoredProfile = {
  firstName: null,
  lastName: null,
  phone: null,
  dob: null,
  gender: null,
  level: null,
  playtomicLevel: null,
};

export const PLAYTOMIC_MIN = 0.5;
export const PLAYTOMIC_MAX = 7;
const MIN_AGE = 5;
const MAX_AGE = 110;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** A real calendar date, and an age that makes sense for a padel player. */
export function isValidDob(dob: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const [y, m, d] = dob.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  const age = ageAt(dob, today);
  return age != null && age >= MIN_AGE && age <= MAX_AGE;
}

export function ageAt(dob: string | null | undefined, today = new Date()): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Playtomic shows levels like 2.5 or 4.25; we keep one decimal. Empty means "didn't say". */
export function parsePlaytomicLevel(v: unknown): number | null | "invalid" {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  if (!Number.isFinite(n)) return "invalid";
  const rounded = Math.round(n * 10) / 10;
  return rounded >= PLAYTOMIC_MIN && rounded <= PLAYTOMIC_MAX ? rounded : "invalid";
}

export type ProfileResult = { ok: true; profile: PlayerProfile } | { ok: false; error: string };

/** Check a submitted profile; the first problem found becomes the error shown to the player. */
export function validateProfile(input: Record<string, unknown>, today = new Date()): ProfileResult {
  const firstName = str(input.firstName, 40);
  const lastName = str(input.lastName, 40);
  if (!firstName) return { ok: false, error: "First name is required" };
  if (!lastName) return { ok: false, error: "Last name is required" };
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "Phone number is required" };
  const badPhone = phoneProblem(phone);
  if (badPhone) return { ok: false, error: badPhone };
  const dob = str(input.dob, 10);
  if (!dob) return { ok: false, error: "Date of birth is required" };
  if (!isValidDob(dob, today)) return { ok: false, error: "That date of birth doesn't look right" };
  const gender = parseGender(input.gender);
  if (!gender) return { ok: false, error: "Pick woman or man" };
  const level = parseLevel(input.level);
  if (level == null) return { ok: false, error: "Pick your playing level" };
  const playtomicLevel = parsePlaytomicLevel(input.playtomicLevel);
  if (playtomicLevel === "invalid") {
    return { ok: false, error: `Playtomic level is a number between ${PLAYTOMIC_MIN} and ${PLAYTOMIC_MAX}` };
  }
  return { ok: true, profile: { firstName, lastName, phone, dob, gender, level, playtomicLevel } };
}

export type ProfilePatchResult = { ok: true; profile: StoredProfile } | { ok: false; error: string };

const blank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

/**
 * An admin's edit of someone else's profile. Unlike the player's own form,
 * any field may be left empty — the organizer often knows a phone and a level
 * but not a date of birth, and the player is still asked for what's missing
 * the next time they sign in. What is given has to be valid, by the same
 * rules as validateProfile.
 */
export function validateProfilePatch(input: Record<string, unknown>, today = new Date()): ProfilePatchResult {
  const firstName = str(input.firstName, 40) || null;
  const lastName = str(input.lastName, 40) || null;
  const phone = normalizePhone(input.phone) || null;
  const badPhone = phone ? phoneProblem(phone) : null;
  if (badPhone) return { ok: false, error: badPhone };
  if (!phone && !blank(input.phone)) return { ok: false, error: "That phone number doesn't look right" };
  const dob = str(input.dob, 10) || null;
  if (dob && !isValidDob(dob, today)) return { ok: false, error: "That date of birth doesn't look right" };
  const gender = blank(input.gender) ? null : parseGender(input.gender);
  if (!gender && !blank(input.gender)) return { ok: false, error: "Pick woman or man" };
  const level = blank(input.level) ? null : parseLevel(input.level);
  if (level == null && !blank(input.level)) return { ok: false, error: "That isn't one of the playing levels" };
  const playtomicLevel = parsePlaytomicLevel(input.playtomicLevel);
  if (playtomicLevel === "invalid") {
    return { ok: false, error: `Playtomic level is a number between ${PLAYTOMIC_MIN} and ${PLAYTOMIC_MAX}` };
  }
  return { ok: true, profile: { firstName, lastName, phone, dob, gender, level, playtomicLevel } };
}

/** True once every required field is on the account. */
export function isProfileComplete(p: StoredProfile): boolean {
  return !!(p.firstName && p.lastName && p.phone && p.dob && p.gender && p.level != null);
}

/** The required details an account still lacks, in the words the form uses — empty when the profile is complete. */
export function missingProfileFields(p: StoredProfile): string[] {
  const missing: string[] = [];
  if (!p.firstName) missing.push("first name");
  if (!p.lastName) missing.push("last name");
  if (!p.phone) missing.push("phone");
  if (!p.dob) missing.push("date of birth");
  if (!p.gender) missing.push("gender");
  if (p.level == null) missing.push("level");
  return missing;
}

/**
 * Accounts from before the profile form have just a display name ("David" or
 * "David Gordon"). Split it so the form starts with what we already know —
 * unless it's only the stand-in the sign-in gives a brand-new account (empty,
 * the email, or the part before the @).
 */
export function namesFromLegacy(name: string | null | undefined, email: string): { firstName: string; lastName: string } {
  const n = (name ?? "").trim().replace(/\s+/g, " ");
  if (!n || n.includes("@") || n.toLowerCase() === email.split("@")[0].toLowerCase()) return { firstName: "", lastName: "" };
  const [first, ...rest] = n.split(" ");
  return { firstName: first.slice(0, 40), lastName: rest.join(" ").slice(0, 40) };
}

/** "First Last" — what the rest of the app shows on court. */
export function displayName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}
