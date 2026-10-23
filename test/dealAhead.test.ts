import { describe, expect, it } from "vitest";
import { americano } from "../src/shared/formats/americano";
import { mexicano } from "../src/shared/formats/mexicano";
import { courtsWhenDealtAhead } from "../src/worker/lib/engine";
import type { MatchRow } from "../src/shared/types";
import { byeSpread, playNight } from "./helpers/night";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const teamsOf = (n: number): [string, string][] => Array.from({ length: n }, (_, i) => [`t${i}a`, `t${i}b`]);
const lastCourt = (night: ReturnType<typeof playNight>, i: number) => {
  const m = night[i].plan.matches.at(-1)!;
  return [...m.a, ...m.b];
};

describe("dealing ahead (a court still finishing)", () => {
  // A player still finishing sits next when the rotation allows (they played this round
  // too, so it's fair); when the rotation says they must play, they share as few
  // courts as possible, so at least one court can always start straight away.
  for (const [name, planner] of [["casual", americano.planRound], ["competitive", mexicano.planRound]] as const) {
    for (const n of [10, 12, 13, 14]) {
      it(`${name}, ${n} players on 2 courts: one court can always start now; sit-outs stay even`, () => {
        for (let seed = 1; seed <= 6; seed++) {
          const night = playNight(planner, { players: ids(n), courts: 2, rounds: 8, seed, dealAhead: true });
          for (let i = 1; i < night.length; i++) {
            const busy = lastCourt(night, i - 1);
            const fours = night[i].plan.matches.map((m) => [...m.a, ...m.b]);
            const playingBusy = fours.flat().filter((p) => busy.includes(p)).length;
            const waiting = fours.filter((f) => f.some((p) => busy.includes(p))).length;
            expect(waiting).toBe(Math.ceil(playingBusy / 4));
            expect(waiting).toBeLessThan(fours.length);
          }
          // Round 2: everyone still finishing round 1 sits it out — every court starts now.
          if (n >= 12) expect(night[1].plan.byes).toEqual(expect.arrayContaining(lastCourt(night, 0)));
          expect(byeSpread(night, ids(n))).toBeLessThanOrEqual(1);
        }
      });
    }
  }

  it("keep teams together, 6 teams on 2 courts: the teams still finishing sit round 2; sit-outs stay even", () => {
    const teams = teamsOf(6);
    for (let seed = 1; seed <= 5; seed++) {
      const night = playNight(americano.planRound, { players: teams.flat(), courts: 2, rounds: 8, seed, teams, dealAhead: true });
      expect(night[1].plan.byes).toEqual(expect.arrayContaining(lastCourt(night, 0)));
      expect(byeSpread(night, teams.flat())).toBeLessThanOrEqual(1);
    }
  });

  it("courts that can start now take the free court; a waiting court takes the court its players are finishing on", () => {
    const m = (court: number, a: [string, string], b: [string, string], status: MatchRow["status"]) =>
      ({ id: `${court}`, roundId: "r", court, a, b, scoreA: null, scoreB: null, status, submittedBy: null }) as MatchRow;
    const current = [m(1, ["a", "b"], ["c", "d"], "confirmed"), m(2, ["e", "f"], ["g", "h"], "pending")];
    const planned = [
      { court: 1, a: ["e", "x"] as [string, string], b: ["y", "z"] as [string, string] },
      { court: 2, a: ["a", "b"] as [string, string], b: ["c", "d"] as [string, string] },
    ];
    const out = courtsWhenDealtAhead(planned, current, 2);
    expect(out.find((p) => p.a.includes("a"))!.court).toBe(1); // all free: the court that just finished
    expect(out.find((p) => p.a.includes("e"))!.court).toBe(2); // waits for e on court 2
  });
});
