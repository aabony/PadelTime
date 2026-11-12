// Phone numbers. Most players are in the USA, so the form starts on +1 and
// asks for a plain 10-digit number; anyone else picks their country code.
// Stored in international form with no spaces: "+15129923681".

export interface Country {
  /** Dial code digits, without the plus: "1", "34". */
  code: string;
  name: string;
  flag: string;
}

export const DEFAULT_COUNTRY_CODE = "1";

/** USA first (the default), then the countries a padel crowd tends to come from, A–Z. */
export const COUNTRIES: Country[] = [
  { code: "1", name: "USA / Canada", flag: "🇺🇸" },
  { code: "54", name: "Argentina", flag: "🇦🇷" },
  { code: "61", name: "Australia", flag: "🇦🇺" },
  { code: "32", name: "Belgium", flag: "🇧🇪" },
  { code: "55", name: "Brazil", flag: "🇧🇷" },
  { code: "56", name: "Chile", flag: "🇨🇱" },
  { code: "57", name: "Colombia", flag: "🇨🇴" },
  { code: "45", name: "Denmark", flag: "🇩🇰" },
  { code: "593", name: "Ecuador", flag: "🇪🇨" },
  { code: "33", name: "France", flag: "🇫🇷" },
  { code: "49", name: "Germany", flag: "🇩🇪" },
  { code: "91", name: "India", flag: "🇮🇳" },
  { code: "972", name: "Israel", flag: "🇮🇱" },
  { code: "39", name: "Italy", flag: "🇮🇹" },
  { code: "52", name: "Mexico", flag: "🇲🇽" },
  { code: "31", name: "Netherlands", flag: "🇳🇱" },
  { code: "51", name: "Peru", flag: "🇵🇪" },
  { code: "351", name: "Portugal", flag: "🇵🇹" },
  { code: "34", name: "Spain", flag: "🇪🇸" },
  { code: "46", name: "Sweden", flag: "🇸🇪" },
  { code: "971", name: "UAE", flag: "🇦🇪" },
  { code: "44", name: "United Kingdom", flag: "🇬🇧" },
  { code: "598", name: "Uruguay", flag: "🇺🇾" },
  { code: "58", name: "Venezuela", flag: "🇻🇪" },
];

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** How many digits follow +1: area code and number. */
export const US_DIGITS = 10;

/**
 * A phone as stored: the leading + and digits only. A bare 10-digit number is
 * a US number (how most of our players type it), so it gains its +1.
 */
export function normalizePhone(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  const digits = digitsOf(s);
  if (s.startsWith("+")) return digits ? `+${digits}` : "";
  return digits.length === US_DIGITS ? `+${DEFAULT_COUNTRY_CODE}${digits}` : digits;
}

/** The country code and the rest of a stored number. Longest code wins ("+351…" is Portugal, not "+35…"). */
export function splitPhone(stored: string | null | undefined): { code: string; national: string } {
  const phone = normalizePhone(stored ?? "");
  if (!phone.startsWith("+")) return { code: DEFAULT_COUNTRY_CODE, national: phone };
  const digits = phone.slice(1);
  const match = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length).find((c) => digits.startsWith(c.code));
  // A code that isn't on our list stays with the number, so nothing is lost when it's saved again.
  return match ? { code: match.code, national: digits.slice(match.code.length) } : { code: "", national: digits };
}

/** Put a country code and what was typed back together, as stored. */
export function joinPhone(code: string, national: string): string {
  const digits = digitsOf(national);
  if (!digits) return "";
  return `+${digitsOf(code)}${digits}`;
}

/** Why a normalized number can't be right, or null when it can. */
export function phoneProblem(phone: string): string | null {
  const digits = digitsOf(phone);
  if (phone.startsWith(`+${DEFAULT_COUNTRY_CODE}`)) {
    // North America: exactly 10 digits after the 1, and an area code never starts with 0 or 1.
    const national = digits.slice(DEFAULT_COUNTRY_CODE.length);
    if (national.length !== US_DIGITS) return "US numbers are 10 digits, area code first";
    if (!/^[2-9]/.test(national)) return "That area code doesn't look right";
    return null;
  }
  return digits.length >= 7 && digits.length <= 15 ? null : "That phone number doesn't look right";
}

export function isValidPhone(phone: string): boolean {
  return phoneProblem(phone) === null;
}

/** For reading: "+1 (512) 992-3681" for a US number, the stored form for anything else. */
export function formatPhone(stored: string | null | undefined): string {
  const phone = normalizePhone(stored ?? "");
  const us = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return us ? `+1 (${us[1]}) ${us[2]}-${us[3]}` : phone;
}
