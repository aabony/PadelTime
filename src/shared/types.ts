// Shared API contract between the Worker and the web client.

export type SessionStatus = "draft" | "open" | "checkin" | "active" | "complete" | "cancelled";
export type PlayerStatus = "confirmed" | "waitlist" | "checked_in" | "dropped";
export type MatchStatus = "pending" | "submitted" | "disputed" | "confirmed";
export type FormatKey = "americano" | "mexicano";
export type GroupRole = "organizer" | "member";

export interface UserInfo {
  id: string;
  name: string;
  email: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  role: GroupRole;
  memberCount: number;
  /** The user's own auto-created crew — hidden from crew lists. */
  isPersonal: boolean;
}

export interface SessionSummary {
  id: string;
  groupId: string;
  groupName: string;
  groupIsPersonal: boolean;
  name: string;
  status: SessionStatus;
  startsAt: number | null;
  durationMin: number | null;
  venue: string | null;
  format: FormatKey;
  courts: number;
  maxPlayers: number;
  pointsPerMatch: number;
  inviteCode: string;
  confirmedCount: number;
  winnerName?: string | null;
}

export interface MeResponse {
  user: UserInfo;
  groups: GroupSummary[];
  sessions: SessionSummary[];
}

export interface GroupMemberRow {
  userId: string;
  name: string;
  role: GroupRole;
  joinedAt: number;
}

export interface GroupDetail {
  id: string;
  name: string;
  myRole: GroupRole;
  members: GroupMemberRow[];
  sessions: SessionSummary[];
}

export interface PlayerRow {
  id: string; // session_player id — this is the id used everywhere in rounds/matches/standings
  name: string;
  userId: string | null;
  isGuest: boolean;
  status: PlayerStatus;
  byes: number;
  checkedInAt: number | null;
  joinedAt: number;
  /** "woman" | "man" | null — used by the mixed-pairs option. */
  gender: "woman" | "man" | null;
  /** Organizer-set level (2 beginner, 3 intermediate, 4 advanced). Only ever sent to the organizer; null for everyone else. */
  level: number | null;
}

export interface MatchRow {
  id: string;
  roundId: string;
  court: number;
  a: [string, string]; // team A session_player ids
  b: [string, string]; // team B session_player ids
  scoreA: number | null;
  scoreB: number | null;
  status: MatchStatus;
  submittedBy: string | null; // session_player id
}

export interface RoundRow {
  id: string;
  number: number;
  /** When the round was dealt — consecutive rounds give real match durations. */
  createdAt: number;
  byes: string[]; // session_player ids
  matches: MatchRow[];
  complete: boolean; // all matches confirmed
}

export interface StandingRow {
  playerId: string;
  name: string;
  points: number;
  against: number;
  diff: number;
  wins: number;
  losses: number;
  ties: number;
  played: number;
  byes: number;
}

export interface SessionDetail {
  id: string;
  groupId: string;
  groupName: string;
  groupIsPersonal: boolean;
  name: string;
  venue: string | null;
  startsAt: number | null;
  durationMin: number | null;
  status: SessionStatus;
  format: FormatKey;
  courts: number;
  maxPlayers: number;
  pointsPerMatch: number;
  /** Every team is one woman + one man whenever the numbers allow. */
  mixedPairs: boolean;
  /** Group players by playing level (organizer-set levels). */
  groupByLevel: boolean;
  inviteCode: string;
  myRole: "organizer" | "player" | "none";
  myPlayerId: string | null;
  players: PlayerRow[];
  rounds: RoundRow[];
  standings: StandingRow[];
  warnings: string[]; // populated for organizers only
  counts: { confirmed: number; waitlist: number; checkedIn: number };
  createdAt: number;
}

export interface JoinInfo {
  sessionId: string;
  name: string;
  groupName: string;
  venue: string | null;
  startsAt: number | null;
  durationMin: number | null;
  status: SessionStatus;
  format: FormatKey;
  courts: number;
  maxPlayers: number;
  pointsPerMatch: number;
  confirmedCount: number;
  waitlistCount: number;
  roundsPlayed: number;
  myStatus: PlayerStatus | null;
  /** Gender on this session, or the one remembered from the last session played. */
  myGender: "woman" | "man" | null;
  mixedPairs: boolean;
  /** Group players by playing level is on (levels themselves are never shared). */
  groupByLevel: boolean;
}

// Read-only public board (TV / court display) payload.
export interface BoardData {
  name: string;
  groupName: string;
  status: SessionStatus;
  format: FormatKey;
  pointsPerMatch: number;
  players: { id: string; name: string }[];
  rounds: RoundRow[];
  standings: StandingRow[];
}

export interface ApiError {
  error: string;
}

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  draft: "Draft",
  open: "Open for signup",
  checkin: "Check-in",
  active: "Live",
  complete: "Finished",
  cancelled: "Cancelled",
};
