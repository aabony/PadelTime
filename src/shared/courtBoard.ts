// The court board: the live screen as one card per court, read like signage.
// A court is in one of four states, and only two of them shout:
//   live  — a game is on it; nothing to do until it ends.
//   go    — its next four can walk on right now (shown for a few minutes).
//   hold  — the court is free, but one of its next four is still playing elsewhere.
//   final — its last dealt game is scored and nothing more is dealt for it yet.

import type { MatchRow, RoundRow } from "./types";

/** How long a court keeps saying "Go now" after it became able to start. */
export const GO_WINDOW_MS = 3 * 60 * 1000;

export type CourtState = "live" | "go" | "hold" | "final";

export interface CourtView {
  court: number;
  state: CourtState;
  /** The game the card is about: on court (live, go) or held (hold). Null once nothing more is dealt here (final). */
  game: MatchRow | null;
  /** The round `game` belongs to (for swapping players in it). */
  round: RoundRow | null;
  /** hold: who the court is waiting for, and the court each is still playing on. */
  waitingFor: { id: string; court: number }[];
  /** The game dealt to follow `game` on this court, and its round. */
  next: MatchRow | null;
  nextRound: RoundRow | null;
  /** The last game finished on this court. */
  last: MatchRow | null;
}

const done = (m: MatchRow) => m.status === "confirmed";
const four = (m: MatchRow) => [...m.a, ...m.b];

/** The round being played and the one dealt up next, as the rest of the app reads them. */
export function liveRounds(rounds: RoundRow[]): { playing?: RoundRow; upNext?: RoundRow } {
  const latest = rounds[rounds.length - 1];
  const prior = rounds[rounds.length - 2];
  const dealtAhead = !!prior && !prior.complete;
  return { playing: dealtAhead ? prior : latest, upNext: dealtAhead ? latest : undefined };
}

export function courtBoard(rounds: RoundRow[], now: number, goMs = GO_WINDOW_MS): CourtView[] {
  const { playing, upNext } = liveRounds(rounds);
  if (!playing) return [];
  const finished = rounds.flatMap((r) => r.matches).filter(done);
  // Everyone still on court in the round being played, and where.
  const busyOn = new Map<string, number>();
  for (const m of playing.matches) if (!done(m)) for (const p of four(m)) busyOn.set(p, m.court);
  // The newest finished game on a court (rounds are oldest first).
  const lastOn = (court: number, not?: MatchRow) => [...finished].reverse().find((m) => m.court === court && m !== not) ?? null;
  // When a game became able to start: its court's last game ended, its players' last games ended, and it was dealt.
  const readyAt = (game: MatchRow, round: RoundRow) =>
    Math.max(
      round.createdAt,
      ...finished.filter((m) => m !== game && (m.court === game.court || four(m).some((p) => four(game).includes(p)))).map((m) => m.confirmedAt ?? 0),
    );

  const courts = [...new Set([...playing.matches, ...(upNext?.matches ?? [])].map((m) => m.court))].sort((a, b) => a - b);
  return courts.map((court): CourtView => {
    const now1 = playing.matches.find((m) => m.court === court);
    const next1 = upNext?.matches.find((m) => m.court === court);
    const base = { court, waitingFor: [], next: null, nextRound: null };
    if (now1 && !done(now1)) {
      const state: CourtState = now - readyAt(now1, playing) < goMs ? "go" : "live";
      const follows = next1 && !done(next1) ? next1 : null;
      return { ...base, state, game: now1, round: playing, next: follows, nextRound: follows ? upNext! : null, last: lastOn(court) };
    }
    if (next1 && upNext && !done(next1)) {
      const waitingFor = four(next1).flatMap((id) => (busyOn.has(id) ? [{ id, court: busyOn.get(id)! }] : []));
      const state: CourtState = waitingFor.length > 0 ? "hold" : now - readyAt(next1, upNext) < goMs ? "go" : "live";
      return { ...base, state, game: next1, round: upNext, waitingFor, last: lastOn(court) };
    }
    return { ...base, state: "final", game: null, round: null, last: lastOn(court) };
  });
}
