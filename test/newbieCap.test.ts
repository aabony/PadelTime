import { describe, expect, it } from "vitest";
import { newbieSpotsLeft, newbiesIn, normalizeNewbieCap, promotable } from "../src/shared/newbieCap";

const p = (status: string, newbie = false, joinedAt = 0) => ({ status, newbie, joinedAt });
const night = { beginnerCourt: true, fixedTeams: false, maxNewbies: 2 as number | null };

describe("the newbie cap", () => {
  it("reads a cap, and treats nothing, zero or nonsense as no limit", () => {
    expect(normalizeNewbieCap(8)).toBe(8);
    expect(normalizeNewbieCap("6")).toBe(6);
    expect(normalizeNewbieCap(null)).toBeNull();
    expect(normalizeNewbieCap(0)).toBeNull();
    expect(normalizeNewbieCap("")).toBeNull();
    expect(normalizeNewbieCap("lots")).toBeNull();
    expect(normalizeNewbieCap(500)).toBe(64);
  });

  it("counts newbies who have a place — not the waitlisted or the dropped", () => {
    const roster = [p("confirmed", true), p("checked_in", true), p("waitlist", true), p("dropped", true), p("confirmed")];
    expect(newbiesIn(roster)).toBe(2);
  });

  it("says how many newbie places are open", () => {
    expect(newbieSpotsLeft(night, [p("confirmed", true)])).toBe(1);
    expect(newbieSpotsLeft(night, [p("confirmed", true), p("checked_in", true)])).toBe(0);
    // The organizer went over the cap by hand: still just "none left".
    expect(newbieSpotsLeft(night, [p("confirmed", true), p("confirmed", true), p("confirmed", true)])).toBe(0);
  });

  it("has no cap without a limit, without a beginner court, or with fixed teams", () => {
    const full = [p("confirmed", true), p("confirmed", true)];
    expect(newbieSpotsLeft({ ...night, maxNewbies: null }, full)).toBeNull();
    expect(newbieSpotsLeft({ ...night, beginnerCourt: false }, full)).toBeNull();
    expect(newbieSpotsLeft({ ...night, fixedTeams: true }, full)).toBeNull();
  });
});

describe("coming off the waitlist", () => {
  it("oldest sign-ups first, up to the open places", () => {
    const roster = [p("confirmed"), p("waitlist", false, 3), p("waitlist", false, 1), p("waitlist", false, 2)];
    expect(promotable(roster, 3, null).map((x) => x.joinedAt)).toEqual([1, 2]);
    expect(promotable(roster, 1, null)).toEqual([]);
  });

  it("a waitlisted newbie waits for a newbie place, without holding up the players behind them", () => {
    const roster = [p("confirmed", true), p("waitlist", true, 1), p("waitlist", false, 2), p("waitlist", true, 3)];
    // No newbie place open: the newbie first in line is passed over, the next player comes in.
    expect(promotable(roster, 10, 0).map((x) => x.joinedAt)).toEqual([2]);
    // One newbie place: the first newbie takes it, the second still waits.
    expect(promotable(roster, 10, 1).map((x) => x.joinedAt)).toEqual([1, 2]);
    // No cap at all: everyone in line comes in.
    expect(promotable(roster, 10, null).map((x) => x.joinedAt)).toEqual([1, 2, 3]);
  });
});
