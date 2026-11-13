// Shared API contract between the Worker and the web client.
import type { StoredProfile } from "./profile";

export type SessionStatus = "draft" | "open" | "checkin" | "active" | "complete" | "cancelled";
export type PlayerStatus = "confirmed" | "waitlist" | "checked_in" | "dropped";
// "skipped": a beginner-court game the organizer moved on from without a score — played, counted for the
// rotation, but no result.
export type MatchStatus = "pending" | "submitted" | "disputed" | "confirmed" | "skipped";
export type FormatKey = "americano" | "mexicano";
export type GroupRole = "organizer" | "member";

export interface UserInfo extends StoredProfile {
  id: string;
  name: string;
  email: string;
  /** May create and run tournaments. */
  isAdmin: boolean;
  /** Every required profile field is filled in (src/shared/profile.ts). */
  profileComplete: boolean;
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
  /** Level (1 newbie, 2 beginner, 3 intermediate, 4 advanced). Only ever sent to the organizer; null for everyone else. */
  level: number | null;
  /** Fixed partner's session_player id when the session keeps teams together. */
  partnerId: string | null;
  /** Organizer-tagged newbie: plays the beginner court. Only ever sent to the organizer. */
  newbie: boolean;
  /** From the player's profile, organizer only (null for guests and for everyone else's view). */
  playtomicLevel: number | null;
  phone: string | null;
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
  /**
   * Which sequence the round belongs to: the tournament's main rounds, or the
   * beginner court's own games (numbered 1, 2, 3… on their own). Absent or
   * null on rounds dealt before the two were separate.
   */
  track?: "main" | "beginner" | null;
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
  /** Has at least half as many games as the busiest player, so counts in the ranking. */
  ranked: boolean;
  /** Team rows (keep teams together): the two players' ids; playerId is then the team key. */
  members?: string[];
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
  /** The rented courts' names, e.g. ["3", "4"]; empty = Court 1..n. */
  courtLabels: string[];
  maxPlayers: number;
  pointsPerMatch: number;
  /** Every team is one woman + one man whenever the numbers allow. */
  mixedPairs: boolean;
  /** Group players by playing level (organizer-set levels). */
  groupByLevel: boolean;
  /** Keep teams together: partners play the whole night as a pair. */
  fixedTeams: boolean;
  /** Beginner court: one court is reserved for organizer-tagged newbies. */
  beginnerCourt: boolean;
  /** Which court that is (1-based internal number; show it with courtLabel). */
  beginnerCourtNo: number;
  /** That court is a coached court: newbies train there with a coach instead of playing games. */
  beginnerCourtCoached: boolean;
  /** The newbie cap (null = no limit): a Newbie signing up past it goes on the waitlist. */
  maxNewbies: number | null;
  /** The coached court is in effect tonight: tagged newbies are out of the draw, and `newbie` is sent to everyone. */
  coachedActive: boolean;
  /** Competitive sit-outs: after the drop round, the bottom of the table sits. */
  competitiveSitouts: boolean;
  /** The drop: sit-outs rotate fairly up to this round; from the next one the table decides. */
  competitiveAfterRound: number;
  /** Finals are on: each round goes to the top of the table and everyone else sits. */
  finals: boolean;
  /** The beginner court is running tonight (toggle on, newbies checked in, enough players). */
  poolsActive: boolean;
  inviteCode: string;
  myRole: "organizer" | "player" | "none";
  myPlayerId: string | null;
  players: PlayerRow[];
  rounds: RoundRow[];
  /** The beginner court's own games (Games mode), oldest first — a separate sequence that never holds up `rounds`. */
  beginnerRounds: RoundRow[];
  /** The ladder's table (everyone, or everyone but the newbies when the beginner court is on). */
  standings: StandingRow[];
  /** One row per team when the session keeps teams together. */
  teamStandings?: StandingRow[];
  /** The beginner court's own table (newbies, from their court-1 games) when the beginner court is on. */
  beginnerStandings?: StandingRow[];
  /** Move up / move down hints for the organizer. */
  nudges?: Nudge[];
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
  /** Signed in but hasn't finished the profile yet (null when signed out). */
  myProfileComplete: boolean | null;
  /** Gender on this session, or the one remembered from the last session played. */
  myGender: "woman" | "man" | null;
  /** Your level on this session (private to you and the organizer), or the one remembered from your last session. */
  myLevel: number | null;
  mixedPairs: boolean;
  /** Group players by playing level is on (players only ever see their own level). */
  groupByLevel: boolean;
  /** Keep teams together is on. */
  fixedTeams: boolean;
  /** Your fixed partner's name, if you have one. */
  myPartner: string | null;
  /** The beginner court is on (newbies the organizer tags play the first court among themselves). */
  beginnerCourt: boolean;
  /** Newbie places still open; null when there's no cap. 0 = a Newbie signing up now goes on the waitlist. */
  newbieSpotsLeft: number | null;
  /** Competitive sit-outs are on (after the drop round, the bottom of the table sits). */
  competitiveSitouts: boolean;
}

// Read-only public board (TV / court display) payload.
export interface ResultsData {
  name: string;
  groupName: string;
  status: SessionStatus;
  format: FormatKey;
  pointsPerMatch: number;
  courtLabels: string[];
  players: { id: string; name: string }[];
  rounds: RoundRow[];
  standings: StandingRow[];
  /** One row per team when the session keeps teams together. */
  teamStandings?: StandingRow[];
  /** The beginner court's table when the session had one. */
  beginnerStandings?: StandingRow[];
}

export interface Nudge {
  playerId: string;
  kind: "up" | "down";
  reason: string;
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
