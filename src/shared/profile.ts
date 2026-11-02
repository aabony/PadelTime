// The player profile: what we know about a person, collected once at
// registration and reused for every tournament they join. Validation lives
// here so the form and the API agree on what counts as complete.
import { parseGender } from "./genders";
import type { Gender } from "./genders";
import { parseLevel } from "./levels";

export interface PlayerProfile {
  firstName: string;
  lastName: string;
  phone: string;
  /** ISO date, "YYYY-MM-DD". */
  dob: string;
  gender: Gender;
  /** Playing level on the app's 2 / 3 / 4 scale (beginner / intermediate / advanced). */
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

/** Keep the leading + and the digits; drop spaces, dashes and brackets. */
export function normalizePhone(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  const plus = s.startsWith("+") ? "+" : "";
  return plus + s.replace(/\D/g, "");
}

export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

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
  if (!isValidPhone(phone)) return { ok: false, error: "That phone number doesn't look right" };
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

/** True once every required field is on the account. */
export function isProfileComplete(p: StoredProfile): boolean {
  return !!(p.firstName && p.lastName && p.phone && p.dob && p.gender && p.level != null);
}

/** "First Last" — what the rest of the app shows on court. */
export function displayName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}
