import { courtLabel, fitCourtLabels, parseCourtLabels } from "../../shared/courts";
import { normalizeLevel } from "../../shared/levels";
import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { gameSessions, groupMembers, groups, matches, rounds, sessionPlayers, user } from "../db/schema";
import { buildHistory, creditAbsences } from "../../shared/history";
import { computeStandings, computeTeamStandings } from "../../shared/standings";
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

// D1 binds at most 100 parameters per statement: id lists go in chunks.
const chunksOf = <T>(xs: T[], size = 90): T[][] => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

export async function loadPlayers(db: DB, sessionId: string): Promise<PlayerRow[]> {
  return (await loadPlayersFor(db, [sessionId])).get(sessionId) ?? [];
}

/** Rosters of several sessions in a few queries, each in roster order (who joined first). */
export async function loadPlayersFor(db: DB, sessionIds: string[]): Promise<Map<string, PlayerRow[]>> {
  const out = new Map<string, PlayerRow[]>(sessionIds.map((id) => [id, []]));
  for (const ids of chunksOf(sessionIds)) {
    const rows = await db
      .select({ sp: sessionPlayers, userName: user.name })
      .from(sessionPlayers)
      .leftJoin(user, eq(sessionPlayers.userId, user.id))
      .where(inArray(sessionPlayers.sessionId, ids));
    for (const { sp, userName } of rows) {
      out.get(sp.sessionId)?.push({
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
        partnerId: sp.partnerId ?? null,
      });
    }
  }
  for (const players of out.values()) players.sort((a, b) => a.joinedAt - b.joinedAt);
  return out;
}

export async function loadRounds(db: DB, sessionId: string): Promise<RoundRow[]> {
  return (await loadRoundsFor(db, [sessionId])).get(sessionId) ?? [];
}

/** Rounds (with their matches) of several sessions in a few queries. */
export async function loadRoundsFor(db: DB, sessionIds: string[]): Promise<Map<string, RoundRow[]>> {
  const out = new Map<string, RoundRow[]>(sessionIds.map((id) => [id, []]));
  for (const ids of chunksOf(sessionIds)) {
    const roundRows = await db.select().from(rounds).where(inArray(rounds.sessionId, ids)).orderBy(rounds.number);
    if (roundRows.length === 0) continue;
    const matchRows = await db.select().from(matches).where(inArray(matches.sessionId, ids));
    const byRound = new Map<string, typeof matchRows>();
    for (const m of matchRows) byRound.set(m.roundId, [...(byRound.get(m.roundId) ?? []), m]);
    for (const r of roundRows) {
      const ms: MatchRow[] = (byRound.get(r.id) ?? [])
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
      out.get(r.sessionId)?.push({
        id: r.id,
        number: r.number,
        createdAt: r.createdAt,
        byes,
        matches: ms,
        complete: ms.length > 0 && ms.every((m) => m.status === "confirmed"),
      });
    }
  }
  return out;
}

export function computeWarnings(players: PlayerRow[], allRounds: RoundRow[], fixedTeams = false, labels: string[] = []): string[] {
  // Things to act on first; partner repeats (often unavoidable) fill whatever room is left.
  const warnings: string[] = [];
  const repeats: string[] = [];
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "?";
  const history = buildHistory(allRounds);

  const latest = allRounds[allRounds.length - 1];
  // Dealt ahead: a court of the round before can still be finishing.
  const finishing = allRounds[allRounds.length - 2];
  for (const m of finishing && !finishing.complete ? finishing.matches : []) {
    if (m.status === "disputed") warnings.push(`Round ${finishing.number}, Court ${courtLabel(labels, m.court)} score is disputed.`);
  }
  if (latest) {
    for (const m of latest.matches) {
      if (m.status === "disputed") warnings.push(`Court ${courtLabel(labels, m.court)} score is disputed.`);
    }
    const confirmed = latest.matches.filter((m) => m.status === "confirmed").length;
    if (confirmed > 0 && confirmed < latest.matches.length) {
      for (const m of latest.matches) {
        if (m.status === "pending") warnings.push(`Court ${courtLabel(labels, m.court)} score hasn't been submitted.`);
      }
    }
  }

  const activeIds = players.filter((p) => p.status === "checked_in").map((p) => p.id);
  // Fixed teams: players who can't play (no partner here) are warned about by
  // name, and left out of the sit-out comparison below — it's not the rotation.
  const benched = new Set<string>();
  if (fixedTeams) {
    const here = new Set(activeIds);
    const byId = new Map(players.map((p) => [p.id, p]));
    const partnerOf = (id: string) => {
      const partner = byId.get(byId.get(id)?.partnerId ?? "");
      return partner && partner.partnerId === id && partner.status !== "dropped" ? partner : undefined;
    };
    for (const id of activeIds) {
      const partner = partnerOf(id);
      if (partner && !here.has(partner.id)) {
        benched.add(id);
        warnings.push(`${nameOf(id)}'s partner ${partner.name} isn't checked in — ${nameOf(id)} sits out until they are, or pair ${nameOf(id)} with someone else.`);
      }
    }
    const singles = activeIds.filter((id) => !partnerOf(id));
    if (singles.length % 2 === 1 && allRounds.length > 0) {
      if (singles.length === 1) benched.add(singles[0]);
      warnings.push(
        singles.length === 1
          ? `${nameOf(singles[0])} has no partner (odd number) and sits out until someone joins or you re-pair.`
          : `An odd number of players have no partner — one sits out each round until someone joins.`,
      );
    }
  }

  const rotating = activeIds.filter((id) => !benched.has(id));
  if (rotating.length > 0 && allRounds.length > 0) {
    // Same accounting as the engine: rounds a late arrival missed count as their share of sit-outs.
    // Real gaps are whole rounds, so only a gap of 2+ is unfair (a late arrival's share is fractional).
    const fair = creditAbsences(buildHistory(allRounds), allRounds, activeIds);
    const byes = rotating.map((id) => fair.byeCounts[id] ?? 0);
    const maxB = Math.max(...byes);
    const minB = Math.min(...byes);
    if (maxB - minB >= 2) {
      const worst = rotating.find((id) => (fair.byeCounts[id] ?? 0) === maxB);
      if (worst) warnings.push(`${nameOf(worst)} has sat out ${Math.round(maxB)} rounds; others only ${Math.round(minB)}.`);
    }
  }

  for (const [key, count] of fixedTeams ? [] : Object.entries(history.partnerCounts)) {
    if (count > 1) {
      const [a, b] = key.split("|");
      repeats.push(`${nameOf(a)} & ${nameOf(b)} have partnered ${count} times.`);
    }
  }
  return [...warnings, ...repeats].slice(0, 6);
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
    courtLabels: fitCourtLabels(parseCourtLabels(session.courtLabels ?? ""), session.courts),
    maxPlayers: session.maxPlayers,
    pointsPerMatch: session.pointsPerMatch,
    mixedPairs: session.mixedPairs,
    groupByLevel: session.groupByLevel,
    fixedTeams: session.fixedTeams,
    inviteCode: session.inviteCode,
    myRole,
    myPlayerId,
    // Levels are private: the organizer sees everyone's, a player only their own.
    players: myRole === "organizer" ? players : players.map((p) => (p.id === myPlayerId ? p : { ...p, level: null })),
    rounds: roundRows,
    standings,
    teamStandings: session.fixedTeams ? computeTeamStandings(players, roundRows) : undefined,
    warnings: myRole === "organizer" ? computeWarnings(players, roundRows, session.fixedTeams, parseCourtLabels(session.courtLabels ?? "")) : [],
    counts,
    createdAt: session.createdAt,
  };
}
