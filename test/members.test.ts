import { describe, expect, it } from "vitest";
import {
  CSV_HEADER,
  NO_STATS,
  csvCell,
  deleteBlock,
  deleteBlockReason,
  filterMembers,
  guestNameFor,
  membersCsv,
  pointsPerGame,
  record,
  sortMembers,
  winRate,
} from "../src/shared/members";
import type { MemberRow } from "../src/shared/members";

const member = (over: Partial<MemberRow> & { id: string }): MemberRow => ({
  name: "Ana Ruiz",
  email: "ana@example.com",
  isAdmin: false,
  profileComplete: true,
  registeredAt: Date.UTC(2026, 9, 1),
  firstName: "Ana",
  lastName: "Ruiz",
  phone: "+34600111222",
  dob: "1990-05-04",
  gender: "woman",
  level: 3,
  playtomicLevel: 3.5,
  stats: { ...NO_STATS },
  deleteBlockedBy: null,
  ...over,
});

const ana = member({ id: "a", stats: { tournaments: 3, games: 10, wins: 7, losses: 2, ties: 1, pointsFor: 152, pointsAgainst: 98, lastPlayedAt: Date.UTC(2026, 10, 8) } });
const ben = member({ id: "b", name: "Ben Ortiz", firstName: "Ben", lastName: "Ortiz", email: "ben@club.es", phone: "+34611333444", gender: "man", level: 1, playtomicLevel: null, registeredAt: Date.UTC(2026, 10, 9), stats: { ...NO_STATS, tournaments: 1 } });
const cy = member({ id: "c", name: "", firstName: null, lastName: null, email: "cy@example.com", phone: null, dob: null, gender: null, level: null, playtomicLevel: null, profileComplete: false, registeredAt: Date.UTC(2026, 10, 5) });
const dee = member({ id: "d", name: "Dee Lang", firstName: "Dee", lastName: "Lang", email: "dee@example.com", level: 4, registeredAt: Date.UTC(2026, 8, 1), stats: { tournaments: 2, games: 4, wins: 1, losses: 3, ties: 0, pointsFor: 40, pointsAgainst: 56, lastPlayedAt: Date.UTC(2026, 9, 20) } });
const all = [ana, ben, cy, dee];

describe("member stats", () => {
  it("points per game, win rate and record", () => {
    expect(pointsPerGame(ana.stats)).toBe(15.2);
    expect(winRate(ana.stats)).toBe(70);
    expect(record(ana.stats)).toBe("7–2–1");
    expect(record(dee.stats)).toBe("1–3");
  });
  it("nothing to show before the first game", () => {
    expect(pointsPerGame(ben.stats)).toBeNull();
    expect(winRate(ben.stats)).toBeNull();
  });
});

describe("sortMembers", () => {
  const ids = (ms: MemberRow[]) => ms.map((m) => m.id).join("");
  it("newest first by default", () => expect(ids(sortMembers(all, "newest"))).toBe("bcad"));
  it("by name, falling back to the email when there's no name yet", () => expect(ids(sortMembers(all, "name"))).toBe("abcd"));
  it("most games", () => expect(ids(sortMembers(all, "games")).slice(0, 2)).toBe("ad"));
  it("points per game, players without a game last", () => expect(ids(sortMembers(all, "ppg"))).toBe("adbc"));
  it("level, strongest first and unset last", () => expect(ids(sortMembers(all, "level"))).toBe("dabc"));
  it("doesn't reorder the list it was given", () => {
    const before = ids(all);
    sortMembers(all, "name");
    expect(ids(all)).toBe(before);
  });
});

describe("filterMembers", () => {
  const ids = (ms: MemberRow[]) => ms.map((m) => m.id).join("");
  it("matches name and email, case-insensitively", () => {
    expect(ids(filterMembers(all, "ORTIZ"))).toBe("b");
    expect(ids(filterMembers(all, "club.es"))).toBe("b");
    expect(ids(filterMembers(all, "  "))).toBe("abcd");
  });
  it("matches a phone however it's typed", () => {
    expect(ids(filterMembers(all, "611 333"))).toBe("b");
    expect(ids(filterMembers(all, "+34 600-111"))).toBe("ad"); // dee shares ana's phone in this fixture
  });
  it("filters by level, alone or with a search", () => {
    expect(ids(filterMembers(all, "", 1))).toBe("b");
    expect(ids(filterMembers(all, "example", 4))).toBe("d");
    expect(ids(filterMembers(all, "", 2))).toBe("");
  });
});

describe("membersCsv", () => {
  const today = new Date(Date.UTC(2026, 10, 11));
  it("one line per member under the header, with stats and age", () => {
    const lines = membersCsv([ana, cy], today).trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(CSV_HEADER.map((h) => `"${h}"`).join(","));
    expect(lines[1]).toBe('"Ana","Ruiz","ana@example.com","+34600111222","1990-05-04","36","Woman","Intermediate","3.5","2026-10-01","3","10","7","2","1","152","98","15.2","2026-11-08"');
    expect(lines[2]).toBe('"","","cy@example.com","","","","","","","2026-11-05","0","0","0","0","0","0","0","",""');
  });
  it("quotes are escaped and formulas defused, but phone numbers stay readable", () => {
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("+cmd|x")).toBe(`"'+cmd|x"`);
    expect(csvCell("-2+3+cmd")).toBe(`"'-2+3+cmd"`);
    expect(csvCell("+34 600 111 222")).toBe('"+34 600 111 222"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(12)).toBe('"12"');
  });
});

describe("deleting a member", () => {
  it("is refused for yourself, another admin, and someone who set up tournaments — in that order", () => {
    expect(deleteBlock({ isSelf: false, isAdmin: false, organized: 0 })).toBeNull();
    expect(deleteBlock({ isSelf: true, isAdmin: true, organized: 3 })).toBe("self");
    expect(deleteBlock({ isSelf: false, isAdmin: true, organized: 3 })).toBe("admin");
    expect(deleteBlock({ isSelf: false, isAdmin: false, organized: 1 })).toBe("organizer");
  });
  it("says why, by name", () => {
    expect(deleteBlockReason("self", "Andrew")).toMatch(/your own account/);
    expect(deleteBlockReason("admin", "Vic")).toBe("Vic is an admin — take their email off the admin list first.");
    expect(deleteBlockReason("organizer", "Dee", 1)).toBe("Dee set up 1 tournament — delete it first.");
    expect(deleteBlockReason("organizer", "Dee", 4)).toBe("Dee set up 4 tournaments — delete those first.");
  });
  it("past results stay under the member's name, or the email's first part when there isn't one", () => {
    expect(guestNameFor("  David Gordon ", "dave@example.com")).toBe("David Gordon");
    expect(guestNameFor("", "dave@example.com")).toBe("dave");
    expect(guestNameFor(null, "dave@example.com")).toBe("dave");
    expect(guestNameFor("x".repeat(60), "dave@example.com")).toHaveLength(40);
  });
});
