import { describe, expect, it } from "vitest";
import { GO_WINDOW_MS, courtBoard } from "../src/shared/courtBoard";
import type { MatchRow, RoundRow } from "../src/shared/types";

const T0 = 1_000_000;
const MIN = 60_000;
let seq = 0;
const game = (court: number, players: string, scoredAt: number | null = null): MatchRow => {
  const [a1, a2, b1, b2] = players.split("");
  return {
    id: `m${++seq}`,
    roundId: "r",
    court,
    a: [a1, a2],
    b: [b1, b2],
    scoreA: scoredAt == null ? null : 10,
    scoreB: scoredAt == null ? null : 6,
    status: scoredAt == null ? "pending" : "confirmed",
    submittedBy: null,
    confirmedAt: scoredAt,
  };
};
const round = (number: number, createdAt: number, matches: MatchRow[]): RoundRow => ({
  id: `r${number}`,
  number,
  createdAt,
  byes: [],
  matches,
  complete: matches.every((m) => m.status === "confirmed"),
  track: "main",
});
const states = (rounds: RoundRow[], now: number) => Object.fromEntries(courtBoard(rounds, now).map((c) => [c.court, c.state]));

describe("the court board", () => {
  it("is empty before a round is dealt", () => {
    expect(courtBoard([], T0)).toEqual([]);
  });

  it("round 1 just dealt: every court says go, then settles to live", () => {
    const r1 = round(1, T0, [game(1, "abcd"), game(2, "efgh")]);
    expect(states([r1], T0 + 30_000)).toEqual({ 1: "go", 2: "go" });
    expect(states([r1], T0 + GO_WINDOW_MS + 1)).toEqual({ 1: "live", 2: "live" });
  });

  it("while a court is playing, its card carries the game dealt to follow it", () => {
    const r1 = round(1, T0, [game(1, "abcd"), game(2, "efgh")]);
    const r2 = round(2, T0 + MIN, [game(1, "ijkl"), game(2, "mnop")]);
    const [c1] = courtBoard([r1, r2], T0 + 10 * MIN);
    expect(c1).toMatchObject({ court: 1, state: "live", game: r1.matches[0], round: r1, next: r2.matches[0], nextRound: r2 });
  });

  it("a court whose game ends says go when its next four are all free — for a few minutes", () => {
    const r1 = round(1, T0, [game(1, "abcd", T0 + 10 * MIN), game(2, "efgh")]);
    const r2 = round(2, T0 + MIN, [game(1, "ijkl"), game(2, "mnop")]);
    const just = courtBoard([r1, r2], T0 + 10 * MIN + 20_000);
    expect(just[0]).toMatchObject({ state: "go", game: r2.matches[0], round: r2, last: r1.matches[0], next: null });
    expect(just[1].state).toBe("live");
    // Three minutes on they're playing: the card is just a live court again.
    expect(states([r1, r2], T0 + 10 * MIN + GO_WINDOW_MS + 1)).toEqual({ 1: "live", 2: "live" });
  });

  it("holds a free court while one of its next four is still playing, and says who and where", () => {
    // Court 1 is done, but "e" (in court 1's next game) is still on court 2.
    const r1 = round(1, T0, [game(1, "abcd", T0 + 10 * MIN), game(2, "efgh")]);
    const r2 = round(2, T0 + MIN, [game(1, "ijke"), game(2, "mnop")]);
    const [c1] = courtBoard([r1, r2], T0 + 10 * MIN + 20_000);
    expect(c1).toMatchObject({ state: "hold", game: r2.matches[0], waitingFor: [{ id: "e", court: 2 }], last: r1.matches[0] });
  });

  it("the hold turns to go the moment that player's game is scored", () => {
    const r1 = round(1, T0, [game(1, "abcd", T0 + 10 * MIN), game(2, "efgh", T0 + 14 * MIN)]);
    const r2 = round(2, T0 + MIN, [game(1, "ijke"), game(2, "mnop")]);
    const r3 = round(3, T0 + 14 * MIN, [game(1, "abgh"), game(2, "cdef")]);
    // Round 1 is complete, so round 2 is the one being played; court 1 could only start at 14:00.
    expect(states([r1, r2, r3], T0 + 14 * MIN + 30_000)).toEqual({ 1: "go", 2: "go" });
  });

  it("a re-dealt round counts as new: its free courts say go again", () => {
    const r1 = round(1, T0, [game(1, "abcd", T0 + 10 * MIN), game(2, "efgh")]);
    const r2 = round(2, T0 + 20 * MIN, [game(1, "ijkl"), game(2, "mnop")]);
    expect(states([r1, r2], T0 + 20 * MIN + 10_000)[1]).toBe("go");
  });

  it("a court with nothing more dealt shows its last result", () => {
    const r1 = round(1, T0, [game(1, "abcd", T0 + 10 * MIN), game(2, "efgh")]);
    const [c1] = courtBoard([r1], T0 + 11 * MIN);
    expect(c1).toMatchObject({ state: "final", game: null, last: r1.matches[0] });
  });

  it("a court idle in the round being played takes its game from the round up next", () => {
    const r1 = round(1, T0, [game(1, "abcd")]);
    const r2 = round(2, T0 + MIN, [game(1, "efgh"), game(2, "ijkl")]);
    const board = courtBoard([r1, r2], T0 + MIN + 10_000);
    expect(board.map((c) => c.court)).toEqual([1, 2]);
    expect(board[1]).toMatchObject({ state: "go", game: r2.matches[1], round: r2 });
  });
});
