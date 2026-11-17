import { describe, expect, it } from "vitest";
import { groupGuests, suggestMember } from "../src/shared/guests";
import type { GuestEntry } from "../src/shared/guests";

const entry = (name: string, sessionId: string, sessionAt: number, games = 4): GuestEntry => ({
  playerId: `${name}-${sessionId}`,
  name,
  sessionId,
  sessionName: `Night ${sessionId}`,
  sessionAt,
  games,
});

describe("players without an account", () => {
  it("groups a name across tournaments, whatever the capitals or spacing", () => {
    const groups = groupGuests([entry("Mark tsukerman", "a", 300, 4), entry("Mark Tsukerman", "b", 100, 5), entry("  mark  tsukerman", "c", 200, 0)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: "Mark tsukerman", games: 9, lastAt: 300 });
    expect(groups[0].entries.map((e) => e.sessionId)).toEqual(["a", "c", "b"]);
  });

  it("lists whoever played most recently first, then by name", () => {
    const groups = groupGuests([entry("Zed", "a", 100), entry("Ashley", "b", 300), entry("Mark", "b", 300), entry("Old Timer", "c", 50)]);
    expect(groups.map((g) => g.name)).toEqual(["Ashley", "Mark", "Zed", "Old Timer"]);
  });
});

describe("who a guest probably is", () => {
  const members = [{ name: "David Gordon" }, { name: "David Taxman" }, { name: "Aaron Gladstein" }, { name: "Aaron Slotnick" }, { name: "Gaby Noveck" }, { name: "Steven" }];
  const pick = (g: string) => suggestMember(g, members)?.name ?? null;

  it("matches the full name, a first name with a last initial, or a first name only one member has", () => {
    expect(pick("gaby noveck")).toBe("Gaby Noveck");
    expect(pick("David G")).toBe("David Gordon");
    expect(pick("David G.")).toBe("David Gordon");
    expect(pick("Gaby N")).toBe("Gaby Noveck");
    expect(pick("Gaby")).toBe("Gaby Noveck");
    expect(pick("Steven")).toBe("Steven");
  });

  it("suggests nobody when more than one member fits, or none does", () => {
    expect(pick("Aaron")).toBeNull();
    expect(pick("David")).toBeNull();
    expect(pick("Aaron S")).toBe("Aaron Slotnick");
    expect(pick("Mark T")).toBeNull();
    expect(pick("Steven L")).toBeNull();
    expect(pick("")).toBeNull();
  });
});
