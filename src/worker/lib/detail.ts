import { normalizeLevel } from "../../shared/levels";
import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { gameSessions, groupMembers, groups, matches, rounds, sessionPlayers, user } from "../db/schema";
import { buildHistory } from "../../shared/history";
import { computeStandings } from "../../shared/standings";
import type {
  MatchRow,
  MatchStatus,
  PlayerRow,
  PlayerStatus,
  RoundRow,
  SessionDetail,
  SessionStatus,
  FormatKey,
} from "../../shared/types";

export type DB = DrizzleD1Database<typeof schema>;
export type SessionRow = typeof gameSessions.$inferSelect;

export async function loadSession(
  db: DB,
  id: string,
): Promise<{ session: SessionRow; groupName: string; groupIsPersonal: boolean } | null> {
  const rows = await db
    .select({ session: gameSessions, groupName: groups.name, groupIsPersonal: groups.isPersonal })
    .from(gameSessions)
    .innerJoin(groups, eq(gameSessions.groupId, groups.id))
    .where(eq(gameSessions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadSessionByCode(
  db: DB,
  code: string,
): Promise<{ session: SessionRow; groupName: string } | null> {
  const rows = await db
    .select({ session: gameSessions, groupName: groups.name })
    .from(gameSessions)
    .innerJoin(groups, eq(gameSessions.groupId, groups.id))
    .where(eq(gameSessions.inviteCode, code.toUpperCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function isGroupOrganizer(db: DB, groupId: string, userId: string): Promise<boolean> {
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!g) return false;
  if (g.ownerId === userId) return true;
  const [m] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return m?.role === "organizer";
}

export async function isGroupMember(db: DB, groupId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return !!m;
}

export async function loadPlayers(db: DB, sessionId: string): Promise<PlayerRow[]> {
  const rows = await db
    .select({ sp: sessionPlayers, userName: user.name })
    .from(sessionPlayers)
    .leftJoin(user, eq(sessionPlayers.userId, user.id))
    .where(eq(sessionPlayers.sessionId, sessionId));
  return rows
    .map(({ sp, userName }) => ({
      id: sp.id,
      name: userName ?? sp.guestName ?? "Player",
      userId: sp.userId,
      isGuest: !sp.userId,
      status: sp.status as PlayerStatus,
      byes: 0, // filled in after rounds load
      checkedInAt: sp.checkedInAt,
      joinedAt: sp.joinedAt,
      gender: (sp.gender as PlayerRow["gender"]) ?? null,
      level: normalizeLevel(sp.level),
    }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

export async function loadRounds(db: DB, sessionId: string): Promise<RoundRow[]> {
  const roundRows = await db
    .select()
    .from(rounds)
    .where(eq(rounds.sessionId, sessionId))
    .orderBy(rounds.number);
  if (roundRows.length === 0) return [];
  const matchRows = await db
    .select()
    .from(matches)
    .where(inArray(matches.roundId, roundRows.map((r) => r.id)));
  return roundRows.map((r) => {
    const ms: MatchRow[] = matchRows
      .filter((m) => m.roundId === r.id)
      .sort((a, b) => a.court - b.court)
      .map((m) => ({
        id: m.id,
        roundId: m.roundId,
        court: m.court,
        a: [m.a1, m.a2],
        b: [m.b1, m.b2],
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        status: m.status as MatchStatus,
        submittedBy: m.submittedBy,
      }));
    let byes: string[] = [];
    try {
      byes = JSON.parse(r.byesJson);
    } catch {
      byes = [];
    }
    return {
      id: r.id,
      number: r.number,
      createdAt: r.createdAt,
      byes,
      matches: ms,
      complete: ms.length > 0 && ms.every((m) => m.status === "confirmed"),
    };
  });
}

export function computeWarnings(players: PlayerRow[], allRounds: RoundRow[]): string[] {
  const warnings: string[] = [];
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "?";
  const history = buildHistory(allRounds);

  for (const [key, count] of Object.entries(history.partnerCounts)) {
    if (count > 1) {
      const [a, b] = key.split("|");
      warnings.push(`${nameOf(a)} & ${nameOf(b)} have partnered ${count} times.`);
    }
  }

  const activeIds = players.filter((p) => p.status === "checked_in").map((p) => p.id);
  if (activeIds.length > 0 && allRounds.length > 0) {
    const byes = activeIds.map((id) => history.byeCounts[id] ?? 0);
    const maxB = Math.max(...byes);
    const minB = Math.min(...byes);
    if (maxB - minB > 1) {
      const worst = activeIds.find((id) => (history.byeCounts[id] ?? 0) === maxB);
      if (worst) warnings.push(`${nameOf(worst)} has sat out ${maxB} rounds; others only ${minB}.`);
    }
  }

  const latest = allRounds[allRounds.length - 1];
  if (latest) {
    for (const m of latest.matches) {
      if (m.status === "disputed") warnings.push(`Court ${m.court} score is disputed.`);
    }
    const confirmed = latest.matches.filter((m) => m.status === "confirmed").length;
    if (confirmed > 0 && confirmed < latest.matches.length) {
      for (const m of latest.matches) {
        if (m.status === "pending") warnings.push(`Court ${m.court} score hasn't been submitted.`);
      }
    }
  }
  return warnings.slice(0, 6);
}

export async function buildDetail(
  db: DB,
  session: SessionRow,
  groupName: string,
  viewerUserId: string | null,
  groupIsPersonal = false,
): Promise<SessionDetail> {
  const players = await loadPlayers(db, session.id);
  const roundRows = await loadRounds(db, session.id);

  for (const p of players) {
    p.byes = roundRows.filter((r) => r.byes.includes(p.id)).length;
  }

  let myRole: SessionDetail["myRole"] = "none";
  let myPlayerId: string | null = null;
  if (viewerUserId) {
    const mine = players.find((p) => p.userId === viewerUserId);
    if (mine) {
      myRole = "player";
      myPlayerId = mine.id;
    }
    if (session.createdBy === viewerUserId || (await isGroupOrganizer(db, session.groupId, viewerUserId))) {
      myRole = "organizer";
    }
  }

  const standings = computeStandings(players, roundRows);
  const counts = {
    confirmed: players.filter((p) => p.status === "confirmed").length,
    waitlist: players.filter((p) => p.status === "waitlist").length,
    checkedIn: players.filter((p) => p.status === "checked_in").length,
  };

  return {
    id: session.id,
    groupId: session.groupId,
    groupName,
    groupIsPersonal,
    name: session.name,
    venue: session.venue,
    startsAt: session.startsAt,
    durationMin: session.durationMin,
    status: session.status as SessionStatus,
    format: session.format as FormatKey,
    courts: session.courts,
    maxPlayers: session.maxPlayers,
    pointsPerMatch: session.pointsPerMatch,
    mixedPairs: session.mixedPairs,
    groupByLevel: session.groupByLevel,
    inviteCode: session.inviteCode,
    myRole,
    myPlayerId,
    // Levels are the organizer's private assessment: strip them for everyone else.
    players: myRole === "organizer" ? players : players.map((p) => ({ ...p, level: null })),
    rounds: roundRows,
    standings,
    warnings: myRole === "organizer" ? computeWarnings(players, roundRows) : [],
    counts,
    createdAt: session.createdAt,
  };
}
