import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Api, useLoad } from "../lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, FieldGroup, Input, Modal, PageSpinner, cls } from "../components/ui";
import { GenderToggle } from "../components/GenderSelect";
import { LevelToggle } from "../components/LevelSelect";
import type { Gender } from "../../shared/genders";
import { genderMeta } from "../../shared/genders";
import { LEVELS, levelMeta } from "../../shared/levels";
import { MEMBER_SORTS, filterMembers, membersCsv, pointsPerGame, record, sortMembers, winRate } from "../../shared/members";
import type { MemberRow, MemberSort } from "../../shared/members";
import { PLAYTOMIC_MAX, PLAYTOMIC_MIN, ageAt, missingProfileFields, namesFromLegacy, validateProfilePatch } from "../../shared/profile";

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
  const { data, error, loading, reload } = useLoad(() => Api.members(), []);
  // Deleting is two taps: the button on a card, then a confirmation that names the person.
  const [deleting, setDeleting] = useState<MemberRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await Api.deleteMember(deleting.id);
      setNotice(`${res.name} was deleted. Their past results stay in the tournaments they played.`);
      setDeleting(null);
      reload();
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };
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

      {notice && <p className="rounded-2xl bg-mint-soft px-4 py-3 text-sm font-semibold text-mint-dark">{notice}</p>}

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
              <MemberCard
                m={m}
                onEdit={() => {
                  setNotice(null);
                  setEditing(m);
                }}
                onDelete={() => {
                  setDeleteError(null);
                  setNotice(null);
                  setDeleting(m);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && shown.length < all.length && (
        <p className="text-center text-xs text-faint">
          Showing {shown.length} of {all.length}. Export CSV saves the ones shown.
        </p>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit member">
        {editing && (
          <MemberEditForm
            key={editing.id}
            m={editing}
            onCancel={() => setEditing(null)}
            onSaved={(name, complete) => {
              setNotice(complete ? `Saved ${name}.` : `Saved ${name}. They'll still be asked for what's missing when they next sign in.`);
              setEditing(null);
              reload();
            }}
          />
        )}
      </Modal>

      <Modal open={!!deleting} onClose={() => !deleteBusy && setDeleting(null)} title="Delete member">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-ink">
              Delete <b className="text-navy">{deleting.name.trim() || deleting.email}</b> ({deleting.email})?
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Their account, profile and sign-in are removed. They'd have to register again.</li>
              <li>
                {deleting.stats.games > 0
                  ? `Their ${deleting.stats.games} game${deleting.stats.games === 1 ? " stays" : "s stay"} in past tournaments under their name, but no longer count${deleting.stats.games === 1 ? "s" : ""} as a member's.`
                  : "They haven't played any games, so nothing else changes."}
              </li>
              <li>This can't be undone.</li>
            </ul>
            <ErrorNote message={deleteError} />
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" disabled={deleteBusy} onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" busy={deleteBusy} onClick={() => void confirmDelete()}>
                Delete {(deleting.name.trim() || deleting.email).split(" ")[0]}
              </Button>
            </div>
          </div>
        )}
      </Modal>
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

function MemberCard({ m, onEdit, onDelete }: { m: MemberRow; onEdit: () => void; onDelete: () => void }) {
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

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-faint">
          Registered {fmtDate(m.registeredAt)}
          {m.stats.lastPlayedAt ? ` · last played ${fmtDate(m.stats.lastPlayedAt)}` : " · no games yet"}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${m.name.trim() || m.email}`}
            className="rounded-full px-2.5 py-1 text-xs font-semibold text-royal hover:bg-royal-soft"
          >
            ✏️ Edit
          </button>
          {/* Your own account, other admins and anyone who set up tournaments can't be deleted from here. */}
          {m.deleteBlockedBy == null && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${m.name.trim() || m.email}`}
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-rose-dark hover:bg-rose-soft"
            >
              🗑 Delete
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The admin's edit of a member: the same details as the player's own form,
 * but nothing is required — fill in what you know. The email is how they sign
 * in, so it's shown and not edited.
 */
function MemberEditForm({ m, onCancel, onSaved }: { m: MemberRow; onCancel: () => void; onSaved: (name: string, complete: boolean) => void }) {
  // An account from before the profile form has a display name only: start from it.
  const known = namesFromLegacy(m.name, m.email);
  const [form, setForm] = useState({
    firstName: m.firstName ?? known.firstName,
    lastName: m.lastName ?? known.lastName,
    phone: m.phone ?? "",
    dob: m.dob ?? "",
    gender: m.gender as Gender | null,
    level: m.level,
    playtomicLevel: m.playtomicLevel == null ? "" : String(m.playtomicLevel),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setError(null);
    setForm((f) => ({ ...f, [key]: value }));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateProfilePatch(form);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    try {
      const res = await Api.updateMember(m.id, form);
      onSaved(res.name, res.profileComplete);
    } catch (e2) {
      setError((e2 as Error).message);
      setBusy(false);
    }
  };
  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <p className="text-sm text-muted">
        Fill in what you know — nothing here is required. Anything left empty, {m.name.trim().split(" ")[0] || "they"} will be asked for at their next sign-in.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoFocus />
        </Field>
        <Field label="Last name">
          <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </Field>
      </div>
      <Field label="Email" hint="How they sign in — it can't be changed here.">
        <Input value={m.email} readOnly className="bg-canvas text-muted" />
      </Field>
      <Field label="Phone">
        <Input type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+34 600 000 000" />
      </Field>
      <Field label="Date of birth">
        <Input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} max={new Date().toISOString().slice(0, 10)} />
      </Field>
      <FieldGroup label="Gender" hint="Tap the selected one again to clear it.">
        <GenderToggle value={form.gender} onChange={(gender) => set("gender", gender)} />
      </FieldGroup>
      <FieldGroup label="Level" hint="Their profile level. A level you set in a tournament's roster for one night isn't changed.">
        <LevelToggle value={form.level} onChange={(level) => set("level", level)} />
      </FieldGroup>
      <Field label="Playtomic level" hint={`${PLAYTOMIC_MIN} to ${PLAYTOMIC_MAX}, if they have one.`}>
        <Input
          type="number"
          inputMode="decimal"
          step="0.1"
          min={PLAYTOMIC_MIN}
          max={PLAYTOMIC_MAX}
          value={form.playtomicLevel}
          onChange={(e) => set("playtomicLevel", e.target.value)}
          placeholder="e.g. 3.5"
        />
      </Field>
      <ErrorNote message={error} />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" busy={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
