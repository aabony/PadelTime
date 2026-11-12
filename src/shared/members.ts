// The admin's members list: everyone who has registered, with their profile
// and what they've played. Search, sort and the CSV export live here so the
// page and the tests agree.
import { genderMeta } from "./genders";
import { levelMeta } from "./levels";
import { normalizePhone } from "./phone";
import { ageAt } from "./profile";
import type { StoredProfile } from "./profile";

export interface MemberStats {
  /** Tournaments joined (not counting ones they dropped out of). */
  tournaments: number;
  /** Games with a confirmed score. */
  games: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** When their latest scored game was recorded (epoch ms). */
  lastPlayedAt: number | null;
}

export interface MemberRow extends StoredProfile {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  /** Finished the registration form (name, phone, date of birth, gender, level). */
  profileComplete: boolean;
  /** When the account was created (epoch ms). */
  registeredAt: number;
  stats: MemberStats;
  /** Why this account can't be deleted from the list, or null when it can. */
  deleteBlockedBy: DeleteBlock | null;
}

/** Accounts the members list won't delete: your own, another admin's, and one that set up tournaments. */
export type DeleteBlock = "self" | "admin" | "organizer";

export function deleteBlock(o: { isSelf: boolean; isAdmin: boolean; organized: number }): DeleteBlock | null {
  if (o.isSelf) return "self";
  if (o.isAdmin) return "admin";
  return o.organized > 0 ? "organizer" : null;
}

/** What to tell the admin, by name, when a delete is refused. */
export function deleteBlockReason(block: DeleteBlock, name: string, organized = 0): string {
  switch (block) {
    case "self":
      return "You can't delete your own account.";
    case "admin":
      return `${name} is an admin — take their email off the admin list first.`;
    default:
      return `${name} set up ${organized || "some"} tournament${organized === 1 ? "" : "s"} — delete ${organized === 1 ? "it" : "those"} first.`;
  }
}

/** The name a deleted member's results stay under in past tournaments. */
export function guestNameFor(name: string | null | undefined, email: string): string {
  return ((name ?? "").trim() || email.split("@")[0] || "Player").slice(0, 40);
}

export interface MembersResponse {
  members: MemberRow[];
}

/**
 * Who to offer in a roster's add-a-player box: every registered member not on
 * the roster yet, A–Z — the whole list before anything is typed, narrowed (best
 * match first) as the organizer types a name or the start of an email. The
 * stand-in test players are never offered here; they have their own button.
 */
export function playerSuggestions(o: {
  query: string;
  members: MemberRow[];
  /** Account ids already on the roster (not counting dropped). */
  rosterUserIds: Iterable<string>;
  limit?: number;
}): MemberRow[] {
  const q = o.query.trim().toLowerCase();
  const taken = new Set(o.rosterUserIds);
  const rank = (m: MemberRow): number => {
    if (!q) return 0;
    const name = m.name.trim().toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (name.includes(q)) return 2;
    return m.email.toLowerCase().startsWith(q) ? 3 : -1;
  };
  // Someone who hasn't filled in a name yet is listed (and sorted) by email.
  const label = (m: MemberRow) => m.name.trim() || m.email;
  return o.members
    .filter((m) => !taken.has(m.id))
    .map((m) => ({ m, r: rank(m) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || label(a.m).localeCompare(label(b.m), undefined, { sensitivity: "base" }))
    .slice(0, o.limit ?? Infinity)
    .map((x) => x.m);
}

export const NO_STATS: MemberStats = { tournaments: 0, games: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, lastPlayedAt: null };

/** Points scored per game played, one decimal; null before the first game. */
export function pointsPerGame(s: MemberStats): number | null {
  return s.games > 0 ? Math.round((s.pointsFor / s.games) * 10) / 10 : null;
}

/** Share of games won, as a whole percentage; null before the first game. */
export function winRate(s: MemberStats): number | null {
  return s.games > 0 ? Math.round((s.wins / s.games) * 100) : null;
}

/** "12–5" or "12–5–1" when there are ties. */
export function record(s: MemberStats): string {
  return s.ties > 0 ? `${s.wins}–${s.losses}–${s.ties}` : `${s.wins}–${s.losses}`;
}

export type MemberSort = "newest" | "name" | "games" | "ppg" | "level";

export const MEMBER_SORTS: { value: MemberSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "name", label: "Name A–Z" },
  { value: "level", label: "Level" },
  { value: "games", label: "Most games" },
  { value: "ppg", label: "Points per game" },
];

const displayNameOf = (m: MemberRow) => m.name.trim() || m.email;

export function sortMembers(members: MemberRow[], by: MemberSort): MemberRow[] {
  const byName = (a: MemberRow, b: MemberRow) => displayNameOf(a).localeCompare(displayNameOf(b), undefined, { sensitivity: "base" });
  const out = [...members];
  switch (by) {
    case "name":
      return out.sort(byName);
    case "games":
      return out.sort((a, b) => b.stats.games - a.stats.games || byName(a, b));
    case "ppg":
      // Players without a game go last, whatever their name.
      return out.sort((a, b) => (pointsPerGame(b.stats) ?? -1) - (pointsPerGame(a.stats) ?? -1) || byName(a, b));
    case "level":
      // Strongest first; no level yet goes last.
      return out.sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || byName(a, b));
    default:
      return out.sort((a, b) => b.registeredAt - a.registeredAt);
  }
}

/** Free-text search over name, email and phone (digits only for the phone), plus an optional level. */
export function filterMembers(members: MemberRow[], query: string, level: number | null = null): MemberRow[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  return members.filter((m) => {
    if (level != null && m.level !== level) return false;
    if (!q) return true;
    if (m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) return true;
    return digits.length >= 3 && (m.phone ?? "").replace(/\D/g, "").includes(digits);
  });
}

/**
 * One CSV cell: quoted, and with anything a spreadsheet would run as a formula
 * defused (names and emails are typed by the public). A phone like "+34 600…"
 * is left as it is — a plus followed by digits is just a number.
 */
export function csvCell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (/^[=@\t\r]/.test(s) || /^[+-](?![\d\s().-]*$)/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const isoDate = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

export const CSV_HEADER = [
  "First name",
  "Last name",
  "Email",
  "Phone",
  "Date of birth",
  "Age",
  "Gender",
  "Level",
  "Playtomic level",
  "Registered",
  "Tournaments",
  "Games",
  "Wins",
  "Losses",
  "Ties",
  "Points for",
  "Points against",
  "Points per game",
  "Last played",
];

/** The whole list as a spreadsheet-ready CSV (one line per member, header first). */
export function membersCsv(members: MemberRow[], today = new Date()): string {
  const rows = members.map((m) => [
    m.firstName ?? "",
    m.lastName ?? (m.firstName ? "" : m.name),
    m.email,
    normalizePhone(m.phone ?? ""),
    m.dob ?? "",
    ageAt(m.dob, today) ?? "",
    genderMeta(m.gender)?.label ?? "",
    levelMeta(m.level)?.label ?? "",
    m.playtomicLevel ?? "",
    isoDate(m.registeredAt),
    m.stats.tournaments,
    m.stats.games,
    m.stats.wins,
    m.stats.losses,
    m.stats.ties,
    m.stats.pointsFor,
    m.stats.pointsAgainst,
    pointsPerGame(m.stats) ?? "",
    isoDate(m.stats.lastPlayedAt),
  ]);
  return [CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
