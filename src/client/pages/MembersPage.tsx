import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Api, useLoad } from "../lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, PageSpinner, cls } from "../components/ui";
import { genderMeta } from "../../shared/genders";
import { LEVELS, levelMeta } from "../../shared/levels";
import { MEMBER_SORTS, filterMembers, membersCsv, pointsPerGame, record, sortMembers, winRate } from "../../shared/members";
import type { MemberRow, MemberSort } from "../../shared/members";
import { ageAt, missingProfileFields, namesFromLegacy } from "../../shared/profile";

// Admin only: everyone who has registered — who they are, how to reach them,
// their level, and what they've played. The server refuses anyone else.

const selectCls =
  "h-10 rounded-2xl border border-line-strong bg-white px-3 text-sm font-semibold text-navy outline-none focus:border-royal focus:ring-4 focus:ring-royal/15";

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

/** "4 May 1990 · 36" from an ISO date. */
function fmtDob(dob: string | null): string | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const age = ageAt(dob);
  return age == null ? date : `${date} · ${age}`;
}

function download(filename: string, text: string) {
  // The BOM makes Excel read accents and emoji-free names as UTF-8.
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function MembersPage() {
  const { data, error, loading } = useLoad(() => Api.members(), []);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<number | null>(null);
  const [sort, setSort] = useState<MemberSort>("newest");

  const all = data?.members ?? [];
  const shown = useMemo(() => sortMembers(filterMembers(all, query, level), sort), [all, query, level, sort]);

  if (loading) return <PageSpinner />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <ErrorNote message={error ?? "Couldn't load the members"} />
        <Link to="/app" className="text-sm font-semibold text-royal">
          ← Back
        </Link>
      </div>
    );
  }

  const played = all.filter((m) => m.stats.games > 0).length;
  const unfinished = all.filter((m) => !m.profileComplete).length;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <Link to="/app" className="text-xs font-bold uppercase tracking-wider text-muted hover:text-royal">
            ← Sessions
          </Link>
          <h1 className="text-2xl font-black tracking-tight text-navy">Members</h1>
          <p className="text-sm text-muted">
            {all.length} registered · {played} have played{unfinished > 0 && ` · ${unfinished} with an incomplete profile`}
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0 whitespace-nowrap"
          disabled={shown.length === 0}
          onClick={() => download(`padeltime-members-${new Date().toISOString().slice(0, 10)}.csv`, membersCsv(shown))}
        >
          ⬇ Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email or phone"
          aria-label="Search members"
          className="min-w-0 flex-1 basis-52"
        />
        <select aria-label="Level" className={selectCls} value={level ?? ""} onChange={(e) => setLevel(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">All levels</option>
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.emoji} {l.label}
            </option>
          ))}
        </select>
        <select aria-label="Sort" className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as MemberSort)}>
          {MEMBER_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? "No members yet" : "Nobody matches"}
          hint={all.length === 0 ? "People appear here as soon as they register." : "Try a different search or level."}
        />
      ) : (
        <ul className="space-y-3" data-testid="members">
          {shown.map((m) => (
            <li key={m.id}>
              <MemberCard m={m} />
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && shown.length < all.length && (
        <p className="text-center text-xs text-faint">
          Showing {shown.length} of {all.length}. Export CSV saves the ones shown.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className="tabular truncate text-sm font-black text-navy">{value}</p>
    </div>
  );
}

/** What an incomplete profile lacks — not counting a name we already have from before the profile form. */
function stillMissing(m: MemberRow): string[] {
  const known = namesFromLegacy(m.name, m.email);
  return missingProfileFields({ ...m, firstName: m.firstName ?? (known.firstName || null), lastName: m.lastName ?? (known.lastName || null) });
}

function MemberCard({ m }: { m: MemberRow }) {
  const level = levelMeta(m.level);
  const gender = genderMeta(m.gender);
  const dob = fmtDob(m.dob);
  const ppg = pointsPerGame(m.stats);
  const rate = winRate(m.stats);
  return (
    <Card className="p-4!">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 truncate text-base font-black text-navy">{m.name.trim() || m.email}</p>
        {gender && (
          <span title={gender.label} aria-label={gender.label}>
            {gender.emoji}
          </span>
        )}
        {level && (
          <Badge tone="sky">
            {level.emoji} {level.label}
          </Badge>
        )}
        {m.playtomicLevel != null && <Badge tone="zinc">Playtomic {m.playtomicLevel.toFixed(1)}</Badge>}
        {m.isAdmin && <Badge tone="lime">Admin</Badge>}
        {!m.profileComplete && <Badge tone="amber">Profile incomplete</Badge>}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={`mailto:${m.email}`} className="min-w-0 truncate font-semibold text-royal hover:text-royal-dark">
          {m.email}
        </a>
        {m.phone && (
          <a href={`tel:${m.phone}`} className="font-semibold text-royal hover:text-royal-dark">
            {m.phone}
          </a>
        )}
        {dob && <span className="text-muted">🎂 {dob}</span>}
      </div>

      {!m.profileComplete && (
        <p className="mt-1.5 text-xs text-amber-dark">
          Missing {stillMissing(m).join(", ")}. They're asked for it the next time they sign in or open a tournament link.
        </p>
      )}

      <div className={cls("mt-3 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-line pt-3 sm:grid-cols-6", m.stats.games === 0 && "opacity-70")}>
        <Stat label="Tournaments" value={m.stats.tournaments} />
        <Stat label="Games" value={m.stats.games} />
        <Stat label="Won–Lost" value={m.stats.games ? record(m.stats) : "—"} />
        <Stat label="Win rate" value={rate == null ? "—" : `${rate}%`} />
        <Stat label="Points" value={m.stats.games ? `${m.stats.pointsFor}–${m.stats.pointsAgainst}` : "—"} />
        <Stat label="Pts / game" value={ppg ?? "—"} />
      </div>

      <p className="mt-2 text-xs text-faint">
        Registered {fmtDate(m.registeredAt)}
        {m.stats.lastPlayedAt ? ` · last played ${fmtDate(m.stats.lastPlayedAt)}` : " · no games yet"}
      </p>
    </Card>
  );
}
