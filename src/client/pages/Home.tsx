import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Api, useLoad } from "../lib/api";
import { dateParts, firstName, fmtTimeRange, fromLocalInputValue } from "../lib/format";
import { SESSION_STATUS_LABEL } from "../../shared/types";
import type { FormatKey, SessionStatus, SessionSummary } from "../../shared/types";
import { StylePicker } from "../components/StylePicker";
import { NightSummary } from "../components/NightSummary";
import { GroupByLevelToggle } from "../components/GroupByLevelToggle";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageSpinner, ProgressBar, cls } from "../components/ui";

export const statusTone = (s: SessionStatus) =>
  s === "active" ? "lime" : s === "checkin" ? "amber" : s === "open" ? "sky" : s === "complete" ? "emerald" : "zinc";

function DateBlock({ ms, muted = false }: { ms: number | null; muted?: boolean }) {
  const d = dateParts(ms);
  return (
    <div
      className={cls(
        "flex w-14 shrink-0 flex-col items-center justify-center rounded-2xl py-2",
        muted ? "bg-canvas text-muted" : "bg-royal-soft text-royal",
      )}
    >
      {d ? (
        <>
          <span className="text-[10px] font-bold uppercase tracking-wider">{d.month}</span>
          <span className="text-2xl font-black leading-none">{d.day}</span>
          <span className="text-[10px] font-semibold">{d.weekday}</span>
        </>
      ) : (
        <span className="text-xs font-bold">TBD</span>
      )}
    </div>
  );
}

function SessionCard({ s }: { s: SessionSummary }) {
  const done = s.status === "complete";
  return (
    <Link to={`/app/sessions/${s.id}`} className="block">
      <Card className="flex items-center gap-4 transition-shadow hover:shadow-md">
        <DateBlock ms={s.startsAt} muted={done} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-black text-navy">{s.name}</p>
            <Badge tone={statusTone(s.status)}>{SESSION_STATUS_LABEL[s.status]}</Badge>
          </div>
          <p className="truncate text-sm text-muted">
            {fmtTimeRange(s.startsAt, s.durationMin)}
            {s.venue ? ` · ${s.venue}` : ""}
          </p>
          {done ? (
            <p className="mt-1 text-sm font-semibold text-navy">
              🏆 {s.winnerName ?? "No scores recorded"}
            </p>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <ProgressBar value={s.confirmedCount} max={s.maxPlayers} className="max-w-40" />
              <span className="tabular text-xs font-semibold text-muted">
                {s.confirmedCount} / {s.maxPlayers}
              </span>
            </div>
          )}
        </div>
        <span className="text-faint">›</span>
      </Card>
    </Link>
  );
}

export function Home() {
  const { data, error, loading, reload } = useLoad(() => Api.me(), []);
  const [params, setParams] = useSearchParams();
  const num = (k: string) => {
    const n = parseInt(params.get(k) ?? "", 10);
    return Number.isFinite(n) ? n : undefined;
  };
  // Arriving from the night planner: open the form with that setup filled in.
  const prefill = params.get("new")
    ? { maxPlayers: num("players"), courts: num("courts"), pointsPerMatch: num("points"), durationMin: num("duration") }
    : undefined;
  const [showCreate, setShowCreate] = useState(!!params.get("new"));
  const navigate = useNavigate();

  if (loading) return <PageSpinner />;
  if (error || !data) return <ErrorNote message={error ?? "Couldn't load"} />;

  const upcoming = data.sessions.filter((s) => s.status !== "complete");
  const past = data.sessions.filter((s) => s.status === "complete");

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-navy">Hey {firstName(data.user.name)} 👋</h1>
          <p className="text-sm text-muted">Ready to hit?</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/plan" className="text-sm font-bold text-royal hover:text-royal-dark">
            Planner
          </Link>
          <Button onClick={() => setShowCreate(true)}>+ New session</Button>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Up next</h2>
        {upcoming.length === 0 ? (
          <EmptyState title="No sessions yet" hint="Set one up in 20 seconds — add names, share a link, or just start.">
            <Button onClick={() => setShowCreate(true)}>Create your first session</Button>
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {upcoming.map((s) => (
              <SessionCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Past sessions</h2>
          <div className="space-y-3">
            {past.map((s) => (
              <SessionCard key={s.id} s={s} />
            ))}
          </div>
        </section>
      )}

      <NewSessionModal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          if (params.get("new")) setParams({}, { replace: true });
        }}
        initial={prefill}
        previous={data.sessions}
        onCreated={(id) => {
          reload();
          navigate(`/app/sessions/${id}`);
        }}
      />
    </div>
  );
}

export interface NewSessionPrefill {
  maxPlayers?: number;
  courts?: number;
  pointsPerMatch?: number;
  durationMin?: number;
}

export function NewSessionModal({
  open,
  onClose,
  previous,
  onCreated,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  previous: SessionSummary[];
  onCreated: (id: string) => void;
  initial?: NewSessionPrefill;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    when: "",
    venue: "",
    durationMin: initial?.durationMin ?? 90,
    courts: initial?.courts ?? 2,
    maxPlayers: initial?.maxPlayers ?? 12,
    pointsPerMatch: initial?.pointsPerMatch ?? 24,
    copyPlayersFrom: "",
    format: "americano" as FormatKey,
    mixedPairs: false,
    groupByLevel: false,
  });
  const num = (v: string, fallback: number) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { id } = await Api.createSession(null, {
        name: form.name.trim() || "Padel night",
        venue: form.venue || null,
        startsAt: fromLocalInputValue(form.when),
        durationMin: form.durationMin,
        courts: form.courts,
        maxPlayers: form.maxPlayers,
        pointsPerMatch: form.pointsPerMatch,
        format: form.format,
        mixedPairs: form.mixedPairs,
        groupByLevel: form.groupByLevel,
        copyPlayersFrom: form.copyPlayersFrom || null,
      });
      onClose();
      onCreated(id);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New session">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Thursday Padel Jam" autoFocus />
        </Field>
        <StylePicker
          value={form.format}
          onChange={(format) => setForm({ ...form, format })}
          grouped={form.groupByLevel}
          hint="You can switch styles later — even mid-session."
        />
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <Field label="When">
            <Input type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
          </Field>
          <Field label="Court time (min)">
            <Input
              type="number"
              min={15}
              max={600}
              step={15}
              className="w-24"
              value={form.durationMin}
              onChange={(e) => setForm({ ...form, durationMin: num(e.target.value, 90) })}
            />
          </Field>
        </div>
        <Field label="Venue">
          <Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Real Padel" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Courts">
            <Input type="number" min={1} max={12} value={form.courts} onChange={(e) => setForm({ ...form, courts: num(e.target.value, 2) })} />
          </Field>
          <Field label="Max players">
            <Input type="number" min={4} max={64} value={form.maxPlayers} onChange={(e) => setForm({ ...form, maxPlayers: num(e.target.value, 12) })} />
          </Field>
          <Field label="Points">
            <Input type="number" min={4} max={99} value={form.pointsPerMatch} onChange={(e) => setForm({ ...form, pointsPerMatch: num(e.target.value, 24) })} />
          </Field>
        </div>
        <NightSummary
          players={form.maxPlayers}
          courts={form.courts}
          durationMin={form.durationMin}
          points={form.pointsPerMatch}
          label="players (max)"
          onApply={(rec) => setForm({ ...form, pointsPerMatch: rec.points, courts: rec.courts })}
        />
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-3.5 py-3">
          <input type="checkbox" className="mt-0.5 size-5 accent-royal" checked={form.mixedPairs} onChange={(e) => setForm({ ...form, mixedPairs: e.target.checked })} />
          <span>
            <span className="block text-sm font-bold text-navy">👩👨 Mixed pairs</span>
            <span className="block text-xs text-muted">Every team is one woman + one man whenever the numbers allow. Players say which they are when they join.</span>
          </span>
        </label>
        <GroupByLevelToggle checked={form.groupByLevel} onChange={(groupByLevel) => setForm({ ...form, groupByLevel })} />
        {previous.length > 0 && (
          <Field label="Bring back the players from" hint="Everyone from that session is added to this one — no re-inviting.">
            <select
              className="w-full rounded-2xl border border-line-strong bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-royal focus:ring-4 focus:ring-royal/15"
              value={form.copyPlayersFrom}
              onChange={(e) => setForm({ ...form, copyPlayersFrom: e.target.value })}
            >
              <option value="">— start with an empty roster —</option>
              {previous.slice(0, 15).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {dateParts(p.startsAt)?.month ?? ""} {dateParts(p.startsAt)?.day ?? ""} ({p.confirmedCount} players)
                </option>
              ))}
            </select>
          </Field>
        )}
        <ErrorNote message={err} />
        <Button className="w-full" size="lg" busy={busy} type="submit">
          Create session
        </Button>
      </form>
    </Modal>
  );
}
