import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Api, usePoll } from "../lib/api";
import { fmtTimeRange, fromLocalInputValue, toLocalInputValue } from "../lib/format";
import { SESSION_STATUS_LABEL } from "../../shared/types";
import type { MatchRow, PlayerRow, RoundRow, SessionDetail } from "../../shared/types";
import { estimateRounds } from "../../shared/timing";
import { resultsText } from "../../shared/share";
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  InfoRow,
  Modal,
  PageSpinner,
  ProgressBar,
  SectionHeader,
  Spinner,
  StatCell,
  cls,
} from "../components/ui";
import { ScoreEntry } from "../components/ScoreEntry";
import { StandingsTable, perGame, rankStyle } from "../components/StandingsTable";
import { statusTone } from "./Home";
import { StylePicker } from "../components/StylePicker";
import { GenderBadge, GenderSelect, GenderToggle } from "../components/GenderSelect";
import { LevelSelect, LevelToggle } from "../components/LevelSelect";
import { GroupByLevelToggle } from "../components/GroupByLevelToggle";
import { TeamsToggle } from "../components/TeamsToggle";
import { PartnerSelect } from "../components/PartnerSelect";
import { CourtNumbersField } from "../components/CourtNumbersField";
import { courtLabel, fitCourtLabels, parseCourtLabels } from "../../shared/courts";
import { NightSummary } from "../components/NightSummary";
import { formatMeta } from "../../shared/formatMeta";

type Run = (key: string, fn: () => Promise<unknown>) => Promise<void>;
type ViewProps = { d: SessionDetail; isOrganizer: boolean; run: Run; busyKey: string | null };

export function SessionPage() {
  const { id = "" } = useParams();
  const { data, error, loading, reload } = usePoll(() => Api.session(id), 4000, [id]);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const navigate = useNavigate();

  const run: Run = async (key, fn) => {
    setBusyKey(key);
    setActionErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  };

  if (loading && !data) return <PageSpinner />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;

  const d = data;
  const isOrganizer = d.myRole === "organizer";

  return (
    <div className="space-y-4">
      <Hero d={d} isOrganizer={isOrganizer} onSettings={() => setShowSettings(true)} />
      <LifecycleStepper d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />
      <ErrorNote message={actionErr} />

      {d.status === "draft" && <DraftView d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />}
      {d.status === "open" && <OpenView d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />}
      {d.status === "checkin" && <CheckinView d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />}
      {d.status === "active" && <ActiveView d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />}
      {d.status === "complete" && <CompleteView d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />}
      {d.status === "cancelled" && (
        <Card>
          <p className="text-muted">This session was cancelled.</p>
        </Card>
      )}

      {!["cancelled", "complete"].includes(d.status) && <RulesCard d={d} />}

      {/* Mounted only while open, so the form starts from the session as it is now. */}
      {isOrganizer && showSettings && (
        <SettingsModal
          d={d}
          open
          onClose={() => setShowSettings(false)}
          run={run}
          busyKey={busyKey}
          onDeleted={() => navigate("/app")}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero: court banner + floating card with the essentials

function ShareIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v13" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

/**
 * Share opens the phone's share sheet (WhatsApp, iMessage…) and falls back to
 * copying on desktop. While the night is on it shares the invite link; once
 * it's finished, the results (podium, table and a link to the results page).
 */
function useShare(d: SessionDetail) {
  const [copied, setCopied] = useState(false);
  const results = d.status === "complete";
  const share = async () => {
    const payload = results
      ? { title: `${d.name} — results`, text: resultsText({ name: d.name, standings: d.teamStandings ?? d.standings }, `${window.location.origin}/join/${d.inviteCode}`) }
      : { title: d.name, text: `Join "${d.name}" on PadelTime`, url: `${window.location.origin}/join/${d.inviteCode}` };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(payload);
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // closed the sheet — nothing to do
      }
    }
    const copy = payload.url ?? payload.text;
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this:", copy);
    }
  };
  return { share, copied, results };
}

function ShareButton({ d }: { d: SessionDetail }) {
  const { share, copied, results } = useShare(d);
  return (
    <button
      type="button"
      onClick={share}
      title={results ? "Share the results" : "Share the invite link with players"}
      className="flex h-10 items-center gap-1.5 rounded-full bg-navy px-3.5 text-xs font-bold text-white shadow-md hover:bg-royal"
    >
      {copied ? (
        results ? "✓ Results copied" : "✓ Link copied"
      ) : (
        <>
          <ShareIcon />
          Share
        </>
      )}
    </button>
  );
}

function Hero({ d, isOrganizer, onSettings }: { d: SessionDetail; isOrganizer: boolean; onSettings: () => void }) {
  // Share is always there: the invite link before the night, the results after.
  const shareable = d.status !== "cancelled";
  return (
    <div>
      {/* The organizer's tools sit in a slim row above the banner, so the banner
          keeps just the way back and Share. */}
      {isOrganizer && (
        <div className="-mt-1 mb-2 flex justify-end gap-1">
          <a
            href={`/print?session=${d.id}`}
            target="_blank"
            rel="noreferrer"
            title="Printable pen & paper sheet"
            className="flex h-8 items-center rounded-full px-3 text-xs font-bold text-muted hover:bg-line hover:text-navy"
          >
            🖨 Print
          </a>
          <button
            type="button"
            aria-label="Settings"
            title="Session settings — style, courts, points, time"
            onClick={onSettings}
            className="flex h-8 items-center rounded-full px-3 text-xs font-bold text-muted hover:bg-line hover:text-navy"
          >
            ⚙ Settings
          </button>
        </div>
      )}
      <div className="court-banner relative min-h-36 rounded-3xl px-3 pb-16 pt-3">
        <div className="flex items-center justify-between gap-2">
          <Link to="/app" aria-label="Back to sessions" className="shrink-0">
            <span className="flex size-10 items-center justify-center rounded-full bg-white text-navy shadow-md">←</span>
          </Link>
          {shareable && <ShareButton d={d} />}
        </div>
      </div>
      <Card className="relative -mt-12 mx-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={statusTone(d.status)}>
            {d.status === "checkin" && d.rounds.length > 0 ? "Paused" : SESSION_STATUS_LABEL[d.status]}
          </Badge>
          {d.mixedPairs && <Badge tone="zinc">👩👨 Mixed pairs</Badge>}
          {d.groupByLevel && <Badge tone="zinc">🎚️ Grouped by level</Badge>}
          {d.fixedTeams && <Badge tone="zinc">🤝 Fixed teams</Badge>}
        </div>
        <h1 className="mt-2 text-2xl font-black leading-tight tracking-tight text-navy">{d.name}</h1>
        {d.startsAt != null && <p className="mt-1 text-sm text-muted">{fmtTimeRange(d.startsAt, d.durationMin)}</p>}
        {d.venue && <p className="text-sm text-muted">📍 {d.venue}</p>}
        <div className="mt-4 grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 border-t border-line pt-4">
          <StatCell label="Format" value={formatMeta(d.format).name} />
          <StatCell label="Points" value={d.pointsPerMatch} />
          <StatCell label="Courts" value={d.courtLabels.length ? d.courtLabels.join(",") : d.courts} />
          <StatCell label="Time" value={d.durationMin ? `${d.durationMin}m` : "—"} />
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The session journey: Players → Play → Results. No check-in step: whoever is
// signed up plays, and anyone who doesn't show gets ✕'d. A paused game
// ("checkin" with rounds played) is still Play; "checkin" before any round only
// exists on sessions from before the step was dropped, and counts as Players.

const STEPS = ["Players", "Play", "Results"] as const;

function stepOf(d: SessionDetail): number {
  if (d.status === "complete") return 2;
  if (d.status === "active" || (d.status === "checkin" && d.rounds.length > 0)) return 1;
  return 0;
}

function LifecycleStepper({ d, isOrganizer, run, busyKey }: ViewProps) {
  if (d.status === "cancelled") return null;
  const current = stepOf(d);

  const advance = (target: number) => {
    if (!isOrganizer || target !== current + 1 || busyKey) return;
    if (target === 2) {
      if (d.status === "active" && window.confirm("Finish the session and lock the final standings?")) {
        run("finish", () => Api.sessionAction(d.id, "complete"));
      }
      return;
    }
    run("start", () => Api.sessionAction(d.id, "start"));
  };

  return (
    <div className="flex items-center gap-1 px-1 py-1">
      {STEPS.map((label, i) => {
        const done = i < current;
        const cur = i === current;
        const clickable = isOrganizer && i === current + 1 && (i === 1 || d.status === "active");
        return (
          <Fragment key={label}>
            {i > 0 && <span className={cls("h-px min-w-3 flex-1", done || cur ? "bg-royal" : "bg-line-strong")} />}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => advance(i)}
              title={clickable ? `Go to ${label}` : undefined}
              className={cls(
                "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition-colors",
                cur
                  ? "bg-royal text-white"
                  : done
                    ? "text-royal"
                    : clickable
                      ? "text-muted hover:bg-line hover:text-navy"
                      : "text-faint",
              )}
            >
              <span
                className={cls(
                  "flex size-4 items-center justify-center rounded-full text-[10px] font-black",
                  cur ? "bg-white text-royal" : done ? "bg-royal text-white" : "bg-line text-faint",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span>{label}</span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules

function RulesCard({ d }: { d: SessionDetail }) {
  // Open before the session starts (new players read them); folded once play is under way.
  const [open, setOpen] = useState(["draft", "open", "checkin"].includes(d.status));
  const n = d.pointsPerMatch;
  const half = Math.ceil(n / 2);
  const lo = Math.floor(n / 2);
  // Two finishing scores for this points setting, e.g. 9–5 or 7–7 for 14.
  const example = `${n - lo + 2}–${lo - 2} or ${n - lo}–${lo}`;
  return (
    <Card className={cls("transition-colors", !open && "hover:border-line-strong")}>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-canvas text-xl">📜</span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-black leading-tight text-navy">The rules of {formatMeta(d.format).name} tournament</span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {open ? "Scoring · serving · winning" : "Tap to read how to play"}
          </span>
        </span>
        <span className="flex h-8 shrink-0 items-center rounded-full bg-canvas px-3 text-xs font-bold text-navy">
          {open ? "Hide ▴" : "Read ▾"}
        </span>
      </button>
      {open && (
        <div className="mt-3 divide-y divide-line border-t border-line">
          <InfoRow icon="🎯">
            <b>Games to {n} points.</b> Every rally scores; the game ends when the scores add up to {n} (e.g. {example}).
          </InfoRow>
          <InfoRow icon="🎾">
            <b>Each player serves 4 points in a row</b>, then the serve passes to the other team: top team's first
            server → bottom team's first → top team's second → bottom team's second, and round again. Switch ends at{" "}
            {half}.
          </InfoRow>
          <InfoRow icon="🏁">
            <b>Most points wins{d.fixedTeams ? " — as a team" : ""}.</b> Ties are allowed.
          </InfoRow>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Settings

function SettingsModal({
  d,
  open,
  onClose,
  run,
  busyKey,
  onDeleted,
}: {
  d: SessionDetail;
  open: boolean;
  onClose: () => void;
  run: Run;
  busyKey: string | null;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState({
    name: d.name,
    venue: d.venue ?? "",
    when: toLocalInputValue(d.startsAt),
    durationMin: d.durationMin ?? 0,
    courts: d.courts,
    courtLabels: d.courtLabels.join(", "),
    maxPlayers: d.maxPlayers,
    pointsPerMatch: d.pointsPerMatch,
    format: d.format,
    mixedPairs: d.mixedPairs,
    groupByLevel: d.groupByLevel,
    fixedTeams: d.fixedTeams,
  });
  const pointsLocked = d.rounds.length > 0;
  const num = (v: string, fallback: number) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  return (
    <Modal open={open} onClose={onClose} title="Session settings">
      <div className="space-y-4">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        {d.status !== "complete" && (
          <StylePicker
            value={form.format}
            onChange={(format) => setForm({ ...form, format })}
            teams={pointsLocked ? d.fixedTeams : form.fixedTeams}
            hint={d.rounds.length > 0 ? "A change applies from the next round dealt." : undefined}
          />
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <Field label="When">
            <Input type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
          </Field>
          <Field label="Court time (min)">
            <Input
              type="number"
              min={0}
              max={600}
              step={15}
              className="w-24"
              value={form.durationMin}
              onChange={(e) => setForm({ ...form, durationMin: num(e.target.value, d.durationMin ?? 0) })}
            />
          </Field>
        </div>
        <Field label="Venue">
          <Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Courts">
            <Input
              type="number"
              min={1}
              max={12}
              value={form.courts}
              onChange={(e) => {
                const courts = num(e.target.value, d.courts);
                const labels = parseCourtLabels(form.courtLabels);
                setForm({ ...form, courts, courtLabels: labels.length ? fitCourtLabels(labels, courts).join(", ") : "" });
              }}
            />
          </Field>
          <Field label="Max players">
            <Input type="number" min={4} max={64} value={form.maxPlayers} onChange={(e) => setForm({ ...form, maxPlayers: num(e.target.value, d.maxPlayers) })} />
          </Field>
          <Field label="Points">
            <Input type="number" min={4} max={99} disabled={pointsLocked} value={pointsLocked ? d.pointsPerMatch : form.pointsPerMatch} onChange={(e) => setForm({ ...form, pointsPerMatch: num(e.target.value, d.pointsPerMatch) })} />
          </Field>
        </div>
        <CourtNumbersField courts={form.courts} value={form.courtLabels} onChange={(courtLabels, courts) => setForm({ ...form, courtLabels, courts })} />
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-3.5 py-3">
          <input
            type="checkbox"
            className="mt-0.5 size-5 accent-royal"
            checked={form.mixedPairs}
            onChange={(e) => setForm({ ...form, mixedPairs: e.target.checked })}
          />
          <span>
            <span className="block text-sm font-bold text-navy">👩👨 Mixed pairs</span>
            <span className="block text-xs text-muted">
              One woman + one man per team when possible. Applies from the next round.
            </span>
          </span>
        </label>
        <GroupByLevelToggle checked={form.groupByLevel} onChange={(groupByLevel) => setForm({ ...form, groupByLevel })} />
        <TeamsToggle
          checked={pointsLocked ? d.fixedTeams : form.fixedTeams}
          disabled={pointsLocked}
          onChange={(fixedTeams) => setForm({ ...form, fixedTeams })}
        />
        {pointsLocked && (
          <p className="text-xs text-muted">
            Points per match and Keep teams together are locked once a round has been dealt. Max players and courts can
            change any time.
          </p>
        )}
        <Button
          className="w-full"
          busy={busyKey === "settings"}
          onClick={() =>
            run("settings", async () => {
              await Api.updateSession(d.id, {
                name: form.name,
                venue: form.venue || null,
                startsAt: fromLocalInputValue(form.when),
                durationMin: form.durationMin || null,
                courts: form.courts,
                courtLabels: parseCourtLabels(form.courtLabels),
                maxPlayers: form.maxPlayers,
                // Locked once a round is dealt (a round may have started since the form opened).
                pointsPerMatch: pointsLocked ? d.pointsPerMatch : form.pointsPerMatch,
                format: form.format,
                mixedPairs: form.mixedPairs,
                groupByLevel: form.groupByLevel,
                fixedTeams: pointsLocked ? d.fixedTeams : form.fixedTeams,
              });
              onClose();
            })
          }
        >
          Save changes
        </Button>
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {d.status !== "complete" && (
            <Button
              variant="danger"
              size="sm"
              busy={busyKey === "cancel"}
              onClick={() => {
                if (window.confirm("Cancel this session for everyone?")) {
                  run("cancel", () => Api.sessionAction(d.id, "cancel"));
                  onClose();
                }
              }}
            >
              Cancel session
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            busy={busyKey === "delete"}
            onClick={() => {
              if (window.confirm("Delete this session and all its results? This can't be undone.")) {
                run("delete", async () => {
                  await Api.deleteSession(d.id);
                  onDeleted();
                });
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Shared cards

function InviteCard({ d }: { d: SessionDetail }) {
  const joinUrl = `${window.location.origin}/join/${d.inviteCode}`;
  const { share, copied } = useShare(d);
  return (
    <Card>
      <SectionHeader title="Invite players" />
      <p className="mb-3 truncate rounded-2xl bg-canvas px-3 py-2.5 font-mono text-xs text-royal">{joinUrl}</p>
      <Button onClick={share}>
        {copied ? (
          "✓ Link copied"
        ) : (
          <>
            <ShareIcon />
            Share invite link
          </>
        )}
      </Button>
    </Card>
  );
}

const firstName = (s: string) => s.trim().toLowerCase().split(/\s+/)[0] ?? "";

/**
 * "Daniel Bogatin" joined with an account while the organizer had already added
 * guest "Daniel": offer a one-tap merge (the guest entry keeps its history).
 */
function MergeHint({ d, p, run, busyKey }: { d: SessionDetail; p: PlayerRow; run: Run; busyKey: string | null }) {
  if (p.isGuest) return null;
  const candidates = d.players.filter((g) => g.isGuest && g.status !== "dropped" && firstName(g.name) === firstName(p.name));
  if (candidates.length === 0) return null;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
      Same person as
      {candidates.map((g) => (
        <button
          key={g.id}
          type="button"
          disabled={busyKey === `merge-${p.id}`}
          className="rounded-full bg-amber-soft px-2 py-0.5 font-bold text-amber-dark hover:brightness-95 disabled:opacity-50"
          onClick={() => {
            if (window.confirm(`Merge ${p.name} into the guest entry "${g.name}"? The guest's results are kept.`)) {
              run(`merge-${p.id}`, () => Api.playerAction(d.id, p.id, "merge", { into: g.id }));
            }
          }}
        >
          {g.name}?
        </button>
      ))}
    </span>
  );
}

/** Organizer-only: how many levels are set, and what grouping does with them. */
function LevelHint({ players }: { players: PlayerRow[] }) {
  const set = players.filter((p) => p.level != null).length;
  return (
    <p className="-mt-1 mb-3 rounded-xl bg-canvas px-3 py-2 text-xs text-muted">
      🎚️ Levels set: <b className={set < players.length ? "text-amber-dark" : "text-navy"}>{set}</b> of {players.length}
      {set < players.length && " (unset = intermediate)"} · players only see their own
    </p>
  );
}

/** The partner who plays with this player, if both still link to each other. */
function partnerOf(d: SessionDetail, p: PlayerRow): PlayerRow | undefined {
  const q = p.partnerId ? d.players.find((x) => x.id === p.partnerId) : undefined;
  return q && q.partnerId === p.id && q.status !== "dropped" ? q : undefined;
}

/**
 * What a round can fill from these players. With Keep teams together only whole
 * teams play: pairs who are both here, plus the unpaired paired up (the engine's rule).
 */
function roundCapacity(d: SessionDetail, here: PlayerRow[]) {
  let playable = here.length;
  if (d.fixedTeams) {
    const ids = new Set(here.map((p) => p.id));
    const pairs = here.filter((p) => {
      const q = partnerOf(d, p);
      return q && ids.has(q.id) && p.id < q.id;
    }).length;
    playable = 2 * (pairs + Math.floor(here.filter((p) => !partnerOf(d, p)).length / 2));
  }
  const courts = Math.min(d.courts, Math.floor(playable / 4));
  return { playable, courts, sitting: here.length - courts * 4 };
}
const signedUp = (d: SessionDetail) => d.players.filter((p) => p.status === "confirmed" || p.status === "checked_in");
const checkedIn = (d: SessionDetail) => d.players.filter((p) => p.status === "checked_in");

/** Keep teams together: who's paired, who'll be paired for you, who can't play. */
function PairingHint({ d }: { d: SessionDetail }) {
  // Before check-in everyone who's in counts; from check-in on, only who's here.
  const live = d.status === "checkin" || d.status === "active";
  const here = d.players.filter((p) => (live ? p.status === "checked_in" : p.status === "confirmed" || p.status === "checked_in"));
  const hereIds = new Set(here.map((p) => p.id));
  const teams = here.filter((p) => {
    const q = partnerOf(d, p);
    return q && hereIds.has(q.id) && p.id < q.id;
  }).length;
  const waiting = here.filter((p) => {
    const q = partnerOf(d, p);
    return q && !hereIds.has(q.id);
  });
  const singles = here.filter((p) => !partnerOf(d, p)).length;
  const how = d.mixedPairs
    ? "woman + man where possible"
    : d.groupByLevel
      ? "same level together"
      : here.some((p) => p.level != null)
        ? "stronger with weaker, by level"
        : "at random — set levels to balance them";
  return (
    <p className="-mt-1 mb-3 rounded-xl bg-canvas px-3 py-2 text-xs text-muted">
      🤝 Teams: <b className="text-navy">{teams}</b> paired
      {singles > 1 && (
        <>
          {" "}
          · <b className="text-navy">{singles - (singles % 2)}</b> player{singles - (singles % 2) === 1 ? "" : "s"} paired for you when the
          round is dealt ({how})
        </>
      )}
      {singles % 2 === 1 && " · 1 without a partner sits out (odd number)"}
      {waiting.length > 0 &&
        ` · ${waiting.map((p) => p.name).join(", ")} wait${waiting.length === 1 ? "s" : ""} for their partner to ${live ? "check in" : "join"}`}
      . Pick a partner below to pair people yourself.
    </p>
  );
}

function playerStatusBadge(p: PlayerRow) {
  switch (p.status) {
    case "checked_in":
      return <Badge tone="lime">here</Badge>;
    case "confirmed":
      return <Badge tone="sky">in</Badge>;
    case "waitlist":
      return <Badge tone="amber">waitlist</Badge>;
    case "dropped":
      return <Badge tone="zinc">out</Badge>;
  }
}

function PlayersCard({ d, isOrganizer, run, busyKey }: ViewProps) {
  const [guestName, setGuestName] = useState("");
  const visible = d.players.filter((p) => p.status !== "dropped");
  const dropped = d.players.filter((p) => p.status === "dropped");
  const inCount = d.counts.confirmed + d.counts.checkedIn;
  const { courts } = roundCapacity(d, signedUp(d));
  return (
    <Card>
      <SectionHeader
        title="Players"
        action={
          <span className="tabular text-sm font-bold text-navy">
            {inCount} <span className="font-medium text-muted">/ {d.maxPlayers}</span>
          </span>
        }
      />
      <ProgressBar value={inCount} max={d.maxPlayers} className="mb-1" />
      {/* Courts per round is in the start / check-in card; here only what needs attention. */}
      {(courts === 0 || d.counts.waitlist > 0) && (
        <p className="text-xs text-muted">
          {courts === 0 ? (inCount < 4 ? "Needs at least 4 players" : "Needs at least two full teams") : ""}
          {courts === 0 && d.counts.waitlist > 0 && " · "}
          {d.counts.waitlist > 0 && `${d.counts.waitlist} waitlisted`}
        </p>
      )}
      <div className="mb-3" />
      {isOrganizer && d.groupByLevel && visible.length > 0 && <LevelHint players={visible} />}
      {isOrganizer && d.fixedTeams && visible.length > 0 && <PairingHint d={d} />}

      {visible.length === 0 && <p className="py-4 text-center text-sm text-muted">Nobody yet — share the invite link or add names below.</p>}
      <ul className="divide-y divide-line">
        {visible.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2.5">
            <Avatar name={p.name} size="sm" ring={p.id === d.myPlayerId} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-navy">
                {p.name}
                {!isOrganizer && <GenderBadge gender={p.gender} className="ml-1.5" />}
                {p.isGuest && <span className="ml-1.5 text-xs font-medium text-faint">guest</span>}
                {p.id === d.myPlayerId && <span className="ml-1.5 text-xs font-bold text-royal">you</span>}
              </span>
              {/* Gender and level on one line, always settable (they carry over to the next night). */}
              {isOrganizer && (
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  <GenderSelect
                    value={p.gender}
                    busy={busyKey === `g-${p.id}`}
                    onChange={(gender) => run(`g-${p.id}`, () => Api.playerAction(d.id, p.id, "set_gender", { gender }))}
                  />
                  <LevelSelect
                    compact
                    value={p.level}
                    busy={busyKey === `lvl-${p.id}`}
                    onChange={(level) => run(`lvl-${p.id}`, () => Api.playerAction(d.id, p.id, "set_level", { level }))}
                  />
                  {d.fixedTeams && (
                    <PartnerSelect
                      player={p}
                      players={d.players}
                      busy={busyKey === `pt-${p.id}`}
                      onChange={(partnerId) => run(`pt-${p.id}`, () => Api.playerAction(d.id, p.id, "set_partner", { partnerId }))}
                    />
                  )}
                </span>
              )}
              {!isOrganizer && d.fixedTeams && partnerOf(d, p) && (
                <span className="block truncate text-xs text-muted">🤝 with {partnerOf(d, p)!.name}</span>
              )}
              {isOrganizer && <MergeHint d={d} p={p} run={run} busyKey={busyKey} />}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Everyone listed is "in": only the waitlist gets a badge. */}
              {p.status === "waitlist" && playerStatusBadge(p)}
              {isOrganizer && p.status === "waitlist" && (
                <Button
                  size="sm"
                  variant="subtle"
                  busy={busyKey === `p-${p.id}`}
                  onClick={() => run(`p-${p.id}`, () => Api.playerAction(d.id, p.id, "promote"))}
                >
                  Bring in
                </Button>
              )}
              {isOrganizer && (
                <button
                  type="button"
                  className="flex size-8 items-center justify-center rounded-full text-faint hover:bg-rose-soft hover:text-rose-dark disabled:pointer-events-none"
                  title="Remove from the session"
                  aria-label={`Remove ${p.name}`}
                  disabled={busyKey === `p-${p.id}`}
                  onClick={() => run(`p-${p.id}`, () => Api.playerAction(d.id, p.id, "drop"))}
                >
                  {busyKey === `p-${p.id}` ? <Spinner className="size-4" /> : "✕"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {dropped.length > 0 && isOrganizer && (
        <div className="mt-2 border-t border-line pt-2">
          {dropped.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-1.5 text-sm text-muted">
              <span className="line-through">{p.name}</span>
              <Button size="sm" variant="subtle" onClick={() => run(`p-${p.id}`, () => Api.playerAction(d.id, p.id, "restore"))}>
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
      {isOrganizer && (
        <form
          className="mt-3 flex gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!guestName.trim()) return;
            run("guest", async () => {
              await Api.addGuest(d.id, guestName.trim());
              setGuestName("");
            });
          }}
        >
          <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Add player by name (no account needed)" />
          <Button variant="secondary" busy={busyKey === "guest"} type="submit">
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}

function MyStatusCard({ d, run, busyKey }: { d: SessionDetail; run: Run; busyKey: string | null }) {
  const me = d.players.find((p) => p.id === d.myPlayerId);
  // The organizer manages their own spot from the roster like anyone else's.
  if (!me || me.status === "dropped" || d.myRole === "organizer") return null;
  return (
    <Card className="border-royal/30 bg-royal-soft/40">
      {me.status === "waitlist" ? (
        <p className="text-sm font-semibold text-amber-dark">You're on the waitlist — you'll move up automatically if a spot opens.</p>
      ) : me.status === "checked_in" ? (
        <p className="text-sm font-semibold text-navy">
          {d.rounds.length > 0
            ? "You're in ✓ — the game resumes when the organizer deals the next round."
            : "You're in ✓ — pairings drop when the organizer starts the session."}
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-navy">You're in ✓</p>
          <Button variant="subtle" size="sm" busy={busyKey === "leave"} onClick={() => run("leave", () => Api.leave(d.id))}>
            Can't make it
          </Button>
        </div>
      )}
      {d.mixedPairs && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line/60 pt-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-navy">You are</p>
            <p className="text-xs text-muted">Mixed pairs night — teams are one woman + one man.</p>
          </div>
          <GenderToggle value={me.gender} busy={busyKey === "mygender"} onChange={(gender) => run("mygender", () => Api.setMyGender(d.id, gender))} />
        </div>
      )}
      <div className="mt-3 border-t border-line/60 pt-3">
        <p className="text-sm font-semibold text-navy">Your level</p>
        <p className="mb-2 text-xs text-muted">Only you and the organizer see it.</p>
        <LevelToggle value={me.level} busy={busyKey === "mylevel"} onChange={(level) => run("mylevel", () => Api.setMyLevel(d.id, level))} />
      </div>
    </Card>
  );
}

function StartPreview({ d, run, busyKey }: { d: SessionDetail; run?: Run; busyKey?: string | null }) {
  const ready = d.counts.confirmed + d.counts.checkedIn;
  if (ready === 0) return null;
  const canApply = run && d.myRole === "organizer" && d.rounds.length === 0;
  // Keep teams together: only whole teams play; the rest sit until paired.
  const cap = roundCapacity(d, signedUp(d));
  return (
    <div className="mt-3">
      <NightSummary
        players={d.fixedTeams ? cap.playable : ready}
        idle={d.fixedTeams ? ready - cap.playable : 0}
        teams={d.fixedTeams}
        courts={d.courts}
        durationMin={d.durationMin}
        points={d.pointsPerMatch}
        onPick={canApply ? (pointsPerMatch) => run("rec", () => Api.updateSession(d.id, { pointsPerMatch })) : undefined}
        applying={busyKey === "rec"}
        folded
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status views

function DraftView({ d, isOrganizer, run, busyKey }: ViewProps) {
  const ready = roundCapacity(d, signedUp(d)).courts > 0;
  return (
    <div className="space-y-4">
      {isOrganizer ? (
        <Card className="border-royal/30">
          <SectionHeader title="Get the session going" />
          <p className="text-sm text-muted">Add names below and start, or open signup and share the link.</p>
          <StartPreview d={d} run={run} busyKey={busyKey} />
          <div className="mt-4 flex flex-wrap gap-2">
            {/* Starting skips signup and deals round 1 with the names added — only once there's a court's worth. */}
            {ready && (
              <Button busy={busyKey === "start"} onClick={() => run("start", () => Api.sessionAction(d.id, "start"))}>
                Start session →
              </Button>
            )}
            <Button variant="secondary" busy={busyKey === "open"} onClick={() => run("open", () => Api.sessionAction(d.id, "open"))}>
              Open signup
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-muted">Signup hasn't opened yet.</p>
        </Card>
      )}
      <PlayersCard d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />
    </div>
  );
}

function OpenView({ d, isOrganizer, run, busyKey }: ViewProps) {
  return (
    <div className="space-y-4">
      <MyStatusCard d={d} run={run} busyKey={busyKey} />
      <InviteCard d={d} />
      {isOrganizer && (
        <Card className="border-royal/30">
          <SectionHeader title="Game day?" />
          <p className="text-sm text-muted">Everyone signed up plays — ✕ anyone who doesn't show, then start.</p>
          <StartPreview d={d} run={run} busyKey={busyKey} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              busy={busyKey === "start"}
              disabled={roundCapacity(d, signedUp(d)).courts === 0}
              onClick={() => run("start", () => Api.sessionAction(d.id, "start"))}
            >
              Start session →
            </Button>
          </div>
        </Card>
      )}
      <PlayersCard d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />
    </div>
  );
}

// "checkin" is the paused game now: every round and the standings kept, the
// roster open for ✕ / bring back / late names, and Resume deals the next round.
// (Before any round it's a session from when check-in was a step: same screen.)
function CheckinView({ d, isOrganizer, run, busyKey }: ViewProps) {
  const { courts: courtsUsed } = roundCapacity(d, signedUp(d));
  const paused = d.rounds.length > 0;
  const nextRound = d.rounds.length + 1;
  return (
    <div className="space-y-4">
      <MyStatusCard d={d} run={run} busyKey={busyKey} />
      {isOrganizer ? (
        <Card className="border-royal/30">
          <SectionHeader title={paused ? "Game paused" : "Game day?"} />
          <p className="text-sm text-muted">
            {paused
              ? `${d.rounds.length} round${d.rounds.length === 1 ? "" : "s"} played, standings kept. Change who's playing, then resume.`
              : "Everyone signed up plays — ✕ anyone who doesn't show, then start."}
          </p>
          {!paused && <StartPreview d={d} run={run} busyKey={busyKey} />}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button busy={busyKey === "start"} disabled={courtsUsed === 0} onClick={() => run("start", () => Api.sessionAction(d.id, "start"))}>
              {paused ? `▶️ Resume · round ${nextRound}` : "Start session →"}
            </Button>
          </div>
        </Card>
      ) : (
        paused && (
          <Card>
            <p className="text-sm text-muted">
              The game is paused between rounds — it resumes when the organizer deals round {nextRound}.
            </p>
          </Card>
        )
      )}
      <PlayersCard d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />
      {paused && (
        <Card>
          <SectionHeader
            title="Standings so far"
            action={
              <span className="text-xs font-semibold text-muted">
                after {d.rounds.length} round{d.rounds.length === 1 ? "" : "s"}
              </span>
            }
          />
          <StandingsTable standings={d.teamStandings ?? d.standings} highlightId={d.myPlayerId} compact />
        </Card>
      )}
      <InviteCard d={d} />
    </div>
  );
}

function teamNames(ids: [string, string], nameOf: (id: string) => string): string {
  return `${nameOf(ids[0])} + ${nameOf(ids[1])}`;
}

function MatchStatusBadge({ m }: { m: MatchRow }) {
  switch (m.status) {
    case "confirmed":
      return <Badge tone="lime">final</Badge>;
    case "submitted":
      return <Badge tone="sky">awaiting confirm</Badge>;
    case "disputed":
      return <Badge tone="rose">disputed</Badge>;
    default:
      return <Badge tone="zinc">live</Badge>;
  }
}

function useNameOf(d: SessionDetail) {
  return useMemo(() => {
    const map = new Map(d.players.map((p) => [p.id, p.name]));
    return (pid: string) => map.get(pid) ?? "?";
  }, [d.players]);
}

function ActiveView({ d, isOrganizer, run, busyKey }: ViewProps) {
  const nameOf = useNameOf(d);
  const me = d.players.find((p) => p.id === d.myPlayerId);
  const current = d.rounds[d.rounds.length - 1];
  // Dealt ahead: the round before can still have a court finishing its game.
  const prior = d.rounds[d.rounds.length - 2];
  const finishingRound = prior && !prior.complete ? prior : undefined;
  const finishing = finishingRound?.matches.filter((m) => m.status !== "confirmed") ?? [];
  const previous = d.rounds.slice(0, -1).filter((r) => r !== finishingRound);
  const waitingFor = waitingForCourt(d, finishing);
  const meFinishing = finishing.find((m) => [...m.a, ...m.b].includes(d.myPlayerId ?? ""));
  // Courts done while others play: the next round can start on them now.
  const freeCourts = current?.matches.filter((m) => m.status === "confirmed") ?? [];
  const playingCourts = current?.matches.filter((m) => m.status !== "confirmed") ?? [];
  const canDealAhead = !!current && !finishingRound && freeCourts.length > 0 && playingCourts.length > 0;
  const label = (m: MatchRow) => `Court ${courtLabel(d.courtLabels, m.court)}`;
  const est = estimateRounds(d.durationMin, d.pointsPerMatch);
  const scrollToPlayers = () => document.getElementById("players")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-4">
      {!current && (
        <Card className="border-royal/30">
          <SectionHeader title="No rounds on the board" />
          {isOrganizer ? (
            <>
              <p className="text-sm text-muted">
                Every round has been undone. Start a fresh round 1 with the {d.counts.checkedIn} player
                {d.counts.checkedIn === 1 ? "" : "s"} here, or pause the game to change who's playing.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button busy={busyKey === "next"} disabled={roundCapacity(d, checkedIn(d)).courts === 0} onClick={() => run("next", () => Api.nextRound(d.id))}>
                  ▶️ Start round 1
                </Button>
                <Button variant="secondary" busy={busyKey === "pause"} onClick={() => run("pause", () => Api.sessionAction(d.id, "pause"))}>
                  ⏸ Pause game
                </Button>
                <Button variant="ghost" onClick={scrollToPlayers}>
                  Manage players ↓
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Waiting for the organizer to start round 1.</p>
          )}
        </Card>
      )}
      {isOrganizer && d.warnings.length > 0 && (
        <div className="rounded-2xl bg-amber-soft px-4 py-3 text-sm font-medium text-amber-dark">
          {d.warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}

      {!isOrganizer && me && me.status === "checked_in" && current && finishingRound && meFinishing && (
        <>
          <MyMatchCard d={d} round={finishingRound} nameOf={nameOf} run={run} busyKey={busyKey} />
          <NextUp d={d} round={current} nameOf={nameOf} />
        </>
      )}
      {!isOrganizer && me && me.status === "checked_in" && current && !meFinishing && (
        <MyMatchCard d={d} round={current} nameOf={nameOf} run={run} busyKey={busyKey} waitingFor={waitingFor} />
      )}
      {!isOrganizer && me && me.status === "waitlist" && (
        <Card className="border-amber-soft bg-amber-soft/40">
          <p className="text-sm font-semibold text-amber-dark">
            You're on the waitlist — the organizer can bring you in between rounds.
          </p>
        </Card>
      )}

      {finishingRound && finishing.length > 0 && (
        <Card className="border-amber-soft">
          <SectionHeader
            title={
              <>
                Round {finishingRound.number} <span className="ml-1 text-sm font-semibold text-muted">· finishing</span>
              </>
            }
            action={<Badge tone="amber">still playing</Badge>}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {finishing.map((m) => (
              <CourtCard key={m.id} d={d} m={m} nameOf={nameOf} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />
            ))}
          </div>
        </Card>
      )}

      {current && (
        <Card>
          <SectionHeader
            title={
              <>
                Round {current.number}
                {d.format === "mexicano" && current.number > 1 && (
                  <span className="ml-1.5 text-sm font-semibold text-muted">· courts by standings</span>
                )}
                {est && (
                  <span className="ml-1.5 text-sm font-semibold text-muted">
                    {current.number <= est ? `of ~${est}` : "· extra time"}
                  </span>
                )}
              </>
            }
            action={
              current.complete ? (
                <Badge tone="lime">all scores in</Badge>
              ) : (
                <Badge tone="zinc">
                  {current.matches.filter((m) => m.status === "confirmed").length}/{current.matches.length} scored
                </Badge>
              )
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {current.matches.map((m) => (
              <CourtCard
                key={m.id}
                d={d}
                m={m}
                round={current}
                nameOf={nameOf}
                isOrganizer={isOrganizer}
                run={run}
                busyKey={busyKey}
                waitingFor={waitingFor(m)}
              />
            ))}
          </div>
        </Card>
      )}

      {isOrganizer && current && (
        <Card>
          {/* One main action, only once it can act (scores in, or a court free to start
              the next round); the rest are rarely needed, so they sit small underneath. */}
          {canDealAhead ? (
            <Button
              className="w-full"
              busy={busyKey === "next"}
              onClick={() => {
                const still = playingCourts.map(label).join(" and ");
                if (
                  !window.confirm(
                    `${still} ${playingCourts.length === 1 ? "is" : "are"} still playing. Deal round ${current.number + 1} now? ${freeCourts.map(label).join(" & ")} start${freeCourts.length === 1 ? "s" : ""} straight away; the rest start as ${still} finish${playingCourts.length === 1 ? "es" : ""}. ${still}'s players sit round ${current.number + 1} when the rotation allows.`,
                  )
                )
                  return;
                run("next", () => Api.nextRound(d.id, { force: true }));
              }}
            >
              ▶️ Start round {current.number + 1} on {freeCourts.map(label).join(" & ")}
            </Button>
          ) : (
            current.complete &&
            !finishingRound && (
              <Button className="w-full" busy={busyKey === "next"} onClick={() => run("next", () => Api.nextRound(d.id))}>
                Next round →
              </Button>
            )
          )}
          <div className={cls("flex flex-wrap justify-center gap-1", (canDealAhead || (current.complete && !finishingRound)) && "mt-2")}>
            {!current.matches.some((m) => m.status === "confirmed") && (
              <Button
                variant="ghost"
                size="sm"
                busy={busyKey === "regen"}
                onClick={() => {
                  if (window.confirm("Throw away these pairings and draw new ones?")) run("regen", () => Api.nextRound(d.id, { regenerate: true }));
                }}
              >
                Redraw
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              busy={busyKey === "undo"}
              onClick={() => {
                if (window.confirm(`Undo round ${current.number}? Its scores will be lost.`)) run("undo", () => Api.undoRound(d.id, current.id));
              }}
            >
              Undo round
            </Button>
            <Button
              variant="ghost"
              size="sm"
              busy={busyKey === "pause"}
              disabled={!current.complete || !!finishingRound}
              title={
                current.complete && !finishingRound
                  ? "Pause between rounds — every round and the standings are kept"
                  : "Enter all of the scores first"
              }
              onClick={() => run("pause", () => Api.sessionAction(d.id, "pause"))}
            >
              ⏸ Pause
            </Button>
            <Button
              variant="ghost"
              size="sm"
              busy={busyKey === "finish"}
              onClick={() => {
                if (window.confirm("Finish the session and lock the final standings?")) run("finish", () => Api.sessionAction(d.id, "complete"));
              }}
            >
              Finish
            </Button>
          </div>
        </Card>
      )}

      {d.teamStandings && d.teamStandings.length > 0 && (
        <Card>
          <SectionHeader title="Team standings" />
          <StandingsTable standings={d.teamStandings} highlightId={d.myPlayerId} compact />
        </Card>
      )}

      <div id="players" className="scroll-mt-20">
        <LiveRosterCard d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />
      </div>

      {previous.length > 0 && <RoundHistory rounds={previous} nameOf={nameOf} />}
    </div>
  );
}

// One list for the live session: the leaderboard IS the roster.
function LiveRosterCard({ d, isOrganizer, run, busyKey }: ViewProps) {
  const [guestName, setGuestName] = useState("");
  const byId = new Map(d.players.map((p) => [p.id, p]));
  // Optimistic removal: the row fades the moment ✕ is tapped and stays that way
  // until the server confirms it (or comes back if the request fails).
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setRemoving((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => byId.get(id)?.status !== "dropped"));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.players]);
  const remove = (id: string) => {
    setRemoving((prev) => new Set(prev).add(id));
    run(`p-${id}`, async () => {
      try {
        await Api.playerAction(d.id, id, "drop");
      } catch (e) {
        setRemoving((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        throw e;
      }
    });
  };
  const playing = d.standings.filter((s) => {
    const p = byId.get(s.playerId);
    return p && (p.status === "checked_in" || p.status === "confirmed");
  });
  const benched = d.players.filter((p) => p.status === "waitlist" || p.status === "dropped");
  const inCount = d.counts.confirmed + d.counts.checkedIn;
  const { courts: courtsUsed, sitting } = roundCapacity(d, checkedIn(d));

  return (
    <Card>
      <SectionHeader
        title="Players & standings"
        action={
          <span className="tabular text-sm font-bold text-navy">
            {inCount} <span className="font-medium text-muted">/ {d.maxPlayers}</span>
          </span>
        }
      />
      <ProgressBar value={inCount} max={d.maxPlayers} className="mb-1" />
      <p className="mb-3 text-xs text-muted">
        {courtsUsed} court{courtsUsed === 1 ? "" : "s"} per round
        {sitting > 0 ? ` · ${sitting} sit${sitting === 1 ? "s" : ""} out each round` : " · everyone plays"}
      </p>
      {isOrganizer && d.groupByLevel && <LevelHint players={d.players.filter((p) => p.status !== "dropped" && p.status !== "waitlist")} />}
      {isOrganizer && d.fixedTeams && <PairingHint d={d} />}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th className="py-2 pr-2 font-semibold">#</th>
              <th className="py-2 pr-2 font-semibold">Player</th>
              <th className="py-2 pr-2 text-right font-semibold" title="Total points — the ranking">
                Pts
              </th>
              <th className="hidden py-2 pr-2 text-right font-semibold sm:table-cell">W-L</th>
              <th className="hidden py-2 pr-2 text-right font-semibold sm:table-cell">+/-</th>
              {isOrganizer && <th className="py-2" />}
            </tr>
          </thead>
          <tbody>
            {playing.map((row, i) => {
              const p = byId.get(row.playerId)!;
              const me = p.id === d.myPlayerId;
              return (
                <tr
                  key={row.playerId}
                  className={cls("border-t border-line transition-opacity", me && "bg-lime-soft", removing.has(p.id) && "opacity-40")}
                >
                  <td className="py-2 pr-2">
                    <span
                      className={cls(
                        "inline-flex size-6 items-center justify-center rounded-full text-xs font-bold",
                        row.ranked ? rankStyle(i) : "bg-canvas text-faint",
                      )}
                    >
                      {row.ranked ? i + 1 : "–"}
                    </span>
                  </td>
                  {/* w-full + max-w-0: the player column takes what's left, so points never scroll off. */}
                  <td className="w-full max-w-0 py-2 pr-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={p.name} size="sm" ring={me} />
                      <div className="min-w-0">
                        <p className="truncate font-bold text-navy">
                          {p.name}
                          {p.isGuest && <span className="ml-1.5 text-xs font-medium text-faint">guest</span>}
                          {me && <span className="ml-1.5 text-xs font-bold text-royal">you</span>}
                        </p>
                        {isOrganizer && (
                          <div className="flex flex-wrap items-center gap-1">
                            <GenderSelect
                              value={p.gender}
                              busy={busyKey === `g-${p.id}`}
                              onChange={(gender) => run(`g-${p.id}`, () => Api.playerAction(d.id, p.id, "set_gender", { gender }))}
                            />
                            <LevelSelect
                              compact
                              value={p.level}
                              busy={busyKey === `lvl-${p.id}`}
                              onChange={(level) => run(`lvl-${p.id}`, () => Api.playerAction(d.id, p.id, "set_level", { level }))}
                            />
                            {d.fixedTeams && (
                              <PartnerSelect
                                player={p}
                                players={d.players}
                                busy={busyKey === `pt-${p.id}`}
                                onChange={(partnerId) => run(`pt-${p.id}`, () => Api.playerAction(d.id, p.id, "set_partner", { partnerId }))}
                              />
                            )}
                          </div>
                        )}
                        {/* Each fact stays whole; the line wraps between them. */}
                        {/* Only facts worth reading: nothing before a first game, no "playing" for everyone. */}
                        {(() => {
                          const facts = [
                            !isOrganizer && d.fixedTeams && partnerOf(d, p) && `🤝 with ${partnerOf(d, p)!.name}`,
                            row.played > 0 && `${row.wins}-${row.losses}${row.ties > 0 ? `-${row.ties}` : ""}`,
                            row.played > 0 && `${perGame(row)} per game`,
                            row.played > 0 && !row.ranked && "too few games to rank",
                            row.byes > 0 && `sat out ${row.byes}`,
                          ].filter(Boolean) as string[];
                          const badge = !isOrganizer && p.gender ? <GenderBadge gender={p.gender} /> : null;
                          if (facts.length === 0 && !badge) return null;
                          return (
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] text-muted">
                              {badge}
                              {facts.map((f, i) => (
                                <span key={f} className="whitespace-nowrap">
                                  {i > 0 && "· "}
                                  {f}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                        {isOrganizer && <MergeHint d={d} p={p} run={run} busyKey={busyKey} />}
                      </div>
                    </div>
                  </td>
                  <td className={cls("tabular py-2 pr-2 text-right text-base font-black", row.ranked ? "text-navy" : "text-muted")}>
                    {row.points}
                  </td>
                  <td className="tabular hidden py-2 pr-2 text-right text-muted sm:table-cell">
                    {row.wins}-{row.losses}
                    {row.ties > 0 ? `-${row.ties}` : ""}
                  </td>
                  <td className={cls("tabular hidden py-2 pr-2 text-right sm:table-cell", row.diff > 0 ? "text-mint-dark" : row.diff < 0 ? "text-rose-dark" : "text-faint")}>
                    {row.diff > 0 ? `+${row.diff}` : row.diff}
                  </td>
                  {isOrganizer && (
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="flex size-8 items-center justify-center rounded-full text-faint hover:bg-rose-soft hover:text-rose-dark disabled:pointer-events-none"
                          title="Remove from the session (from the next round)"
                          aria-label={`Remove ${p.name}`}
                          disabled={removing.has(p.id)}
                          onClick={() => remove(p.id)}
                        >
                          {removing.has(p.id) ? <Spinner className="size-4" /> : "✕"}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {benched.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">Not playing</p>
          {benched.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={p.name} size="sm" className="opacity-60" />
                <span className={cls("truncate font-semibold", p.status === "dropped" ? "text-muted line-through" : "text-navy")}>{p.name}</span>
                {playerStatusBadge(p)}
              </span>
              {isOrganizer && (
                <Button
                  size="sm"
                  variant="subtle"
                  busy={busyKey === `p-${p.id}`}
                  onClick={() => run(`p-${p.id}`, () => Api.playerAction(d.id, p.id, p.status === "dropped" ? "restore" : "checkin"))}
                >
                  {p.status === "dropped" ? "Bring back" : "Bring in"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {isOrganizer && (
        <form
          className="mt-3 flex gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!guestName.trim()) return;
            run("guest", async () => {
              await Api.addGuest(d.id, guestName.trim());
              setGuestName("");
            });
          }}
        >
          <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Add a late arrival by name" />
          <Button variant="secondary" busy={busyKey === "guest"} type="submit">
            Add
          </Button>
        </form>
      )}
      {isOrganizer && <p className="mt-2 text-xs text-muted">Player changes apply from the next round dealt.</p>}
    </Card>
  );
}

/**
 * Dealt ahead: what a next-round game waits for — the court its players are
 * still finishing on, or its own court while the last game there finishes.
 */
function waitingForCourt(d: SessionDetail, finishing: MatchRow[]) {
  const on = new Map<string, number>();
  for (const m of finishing) for (const p of [...m.a, ...m.b]) on.set(p, m.court);
  const occupied = new Set(finishing.map((m) => m.court));
  return (m: MatchRow) => {
    const court = [...m.a, ...m.b].map((p) => on.get(p)).find((c) => c != null) ?? (occupied.has(m.court) ? m.court : undefined);
    return court == null ? undefined : `Court ${courtLabel(d.courtLabels, court)}`;
  };
}

/** While you finish a game, what's next for you in the round already dealt. */
function NextUp({ d, round, nameOf }: { d: SessionDetail; round: RoundRow; nameOf: (id: string) => string }) {
  const me = d.myPlayerId!;
  const next = round.matches.find((m) => [...m.a, ...m.b].includes(me));
  if (!next) return null;
  return (
    <Card className="border-line bg-canvas/60">
      <p className="text-xs font-bold uppercase tracking-wider text-muted">Next · round {round.number}</p>
      <p className="mt-1 text-sm text-ink">
        <b className="text-navy">Court {courtLabel(d.courtLabels, next.court)}</b> —{" "}
        {teamNames(next.a.includes(me) ? next.a : next.b, nameOf)} vs {teamNames(next.a.includes(me) ? next.b : next.a, nameOf)}
      </p>
    </Card>
  );
}

function CourtCard({
  d,
  m,
  round,
  waitingFor,
  nameOf,
  isOrganizer,
  run,
  busyKey,
}: {
  d: SessionDetail;
  m: MatchRow;
  /** The round on court: given, the organizer can swap players in this game until it has a score. */
  round?: RoundRow;
  /** Dealt ahead: the court this game waits on ("Court 4"), while its players finish there. */
  waitingFor?: string;
  nameOf: (id: string) => string;
  isOrganizer: boolean;
  run: Run;
  busyKey: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const scored = m.scoreA != null && m.scoreB != null;
  const canSwap = isOrganizer && !!round && !d.fixedTeams && !scored && m.status === "pending";
  const court = `Court ${courtLabel(d.courtLabels, m.court)}`;
  return (
    <div className="rounded-2xl border border-line bg-canvas/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-2xl font-black uppercase tracking-tight text-royal">
          <span aria-hidden>🏟️</span>
          <span>{court}</span>
        </span>
        <MatchStatusBadge m={m} />
      </div>
      {waitingFor && <p className="-mt-1 mb-2 text-xs font-bold text-amber-dark">⏳ Starts when {waitingFor} finishes</p>}
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-bold text-navy">{teamNames(m.a, nameOf)}</span>
          <span className="tabular text-2xl font-black text-navy">{m.scoreA ?? "–"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-bold text-navy">{teamNames(m.b, nameOf)}</span>
          <span className="tabular text-2xl font-black text-navy">{m.scoreB ?? "–"}</span>
        </div>
      </div>
      {isOrganizer && (
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" size="sm" variant={scored ? "subtle" : "primary"} aria-label={`${scored ? "Edit" : "Enter"} score, ${court}`} onClick={() => setEditing(true)}>
            {scored ? "✏️ Edit score" : "📝 Enter score"}
          </Button>
          {canSwap && (
            <Button size="sm" variant="subtle" aria-label={`Swap a player, ${court}`} onClick={() => setSwapping(true)}>
              ⇄ Swap
            </Button>
          )}
        </div>
      )}
      <Modal open={editing} onClose={() => setEditing(false)} title={`${court} — score`}>
        <ScoreEntry
          total={d.pointsPerMatch}
          teamA={teamNames(m.a, nameOf)}
          teamB={teamNames(m.b, nameOf)}
          initialA={m.scoreA}
          busy={busyKey === `score-${m.id}`}
          submitLabel="Save score"
          onSubmit={(a, b) =>
            run(`score-${m.id}`, async () => {
              await Api.score(m.id, a, b);
              setEditing(false);
            })
          }
        />
      </Modal>
      {canSwap && round && (
        <SwapModal open={swapping} onClose={() => setSwapping(false)} d={d} m={m} round={round} nameOf={nameOf} run={run} busyKey={busyKey} />
      )}
    </div>
  );
}

/** Swap a player in a game: tap who's going off, then who's coming on. */
function SwapModal({
  open,
  onClose,
  d,
  m,
  round,
  nameOf,
  run,
  busyKey,
}: {
  open: boolean;
  onClose: () => void;
  d: SessionDetail;
  m: MatchRow;
  round: RoundRow;
  nameOf: (id: string) => string;
  run: Run;
  busyKey: string | null;
}) {
  const [out, setOut] = useState<string | null>(null);
  const label = (court: number) => `Court ${courtLabel(d.courtLabels, court)}`;
  const inRound = new Set([...round.byes, ...round.matches.flatMap((x) => [...x.a, ...x.b])]);
  // Who can come on: sitting out first, then players on other courts without a score yet, then late arrivals.
  const candidates = [
    ...round.byes.map((id) => ({ id, note: "sitting out" })),
    ...round.matches
      .filter((x) => x.id !== m.id && x.scoreA == null && x.status === "pending")
      .flatMap((x) => [...x.a, ...x.b].map((id) => ({ id, note: label(x.court) }))),
    ...d.players
      .filter((p) => p.status === "checked_in" && !inRound.has(p.id))
      .map((p) => ({ id: p.id, note: "just arrived" })),
  ];
  const close = () => {
    setOut(null);
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title={`${label(m.court)} — swap a player`}>
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Going off</p>
      <div className="grid grid-cols-2 gap-2">
        {[...m.a, ...m.b].map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={out === id}
            onClick={() => setOut(id)}
            className={cls(
              "truncate rounded-xl border px-3 py-2 text-left text-sm font-bold",
              out === id ? "border-royal bg-royal text-white" : "border-line bg-white text-navy hover:border-line-strong",
            )}
          >
            {nameOf(id)}
          </button>
        ))}
      </div>
      {out && (
        <>
          <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-muted">Coming on for {nameOf(out)}</p>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted">Nobody free to swap in.</p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busyKey === "swap"}
                  onClick={() =>
                    run("swap", async () => {
                      await Api.swapPlayer(d.id, round.id, out, c.id);
                      close();
                    })
                  }
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2 text-left text-sm hover:border-royal disabled:opacity-50"
                >
                  <span className="truncate font-bold text-navy">{nameOf(c.id)}</span>
                  <span className="shrink-0 text-xs text-muted">{c.note}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function MyMatchCard({
  d,
  round,
  nameOf,
  run,
  busyKey,
  waitingFor,
}: {
  d: SessionDetail;
  round: RoundRow;
  nameOf: (id: string) => string;
  run: Run;
  busyKey: string | null;
  waitingFor?: (m: MatchRow) => string | undefined;
}) {
  const me = d.myPlayerId!;
  const myMatch = round.matches.find((m) => [...m.a, ...m.b].includes(me));
  const [editing, setEditing] = useState(false);

  // Sitting out (or dealt in from the next round): nothing to show — the round card says who's on.
  if (!myMatch) return null;

  const myTeam: "a" | "b" = myMatch.a.includes(me) ? "a" : "b";
  const partner = (myTeam === "a" ? myMatch.a : myMatch.b).find((x) => x !== me)!;
  const opponents = myTeam === "a" ? myMatch.b : myMatch.a;
  const submittedByMyTeam =
    myMatch.submittedBy != null && (myTeam === "a" ? myMatch.a : myMatch.b).includes(myMatch.submittedBy);
  // Always "your team first": a player on the second team who entered 14–10 must see 14–10, not 10–14.
  const myScore = myTeam === "a" ? myMatch.scoreA : myMatch.scoreB;
  const theirScore = myTeam === "a" ? myMatch.scoreB : myMatch.scoreA;
  const scoreLine = myScore != null && theirScore != null ? `${myScore}–${theirScore}` : null;
  const outcome =
    myScore == null || theirScore == null ? null : myScore > theirScore ? "win" : myScore < theirScore ? "loss" : "tie";

  return (
    <Card className="border-royal/40 shadow-md">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">Round {round.number} · your match</span>
        <MatchStatusBadge m={myMatch} />
      </div>
      <p className="text-center text-4xl font-black tracking-tight text-royal">
        <span aria-hidden>🏟️</span> COURT {courtLabel(d.courtLabels, myMatch.court)}
      </p>
      {waitingFor?.(myMatch) && (
        <p className="mt-1 text-center text-sm font-bold text-amber-dark">⏳ Starts when {waitingFor(myMatch)} finishes</p>
      )}
      <div className="mt-4 flex items-center justify-center gap-4">
        <div className="flex flex-col items-center gap-1">
          <div className="flex -space-x-2">
            <Avatar name={nameOf(me)} ring />
            <Avatar name={nameOf(partner)} />
          </div>
          <p className="text-sm font-bold text-navy">You + {nameOf(partner)}</p>
        </div>
        <span className="text-xs font-black uppercase tracking-widest text-faint">vs</span>
        <div className="flex flex-col items-center gap-1">
          <div className="flex -space-x-2">
            <Avatar name={nameOf(opponents[0])} />
            <Avatar name={nameOf(opponents[1])} />
          </div>
          <p className="text-sm font-bold text-navy">{teamNames(opponents, nameOf)}</p>
        </div>
      </div>

      <div className="mt-5">
        {myMatch.status === "pending" && (
          <>
            {!editing ? (
              <Button className="w-full" size="lg" onClick={() => setEditing(true)}>
                📝 Enter score
              </Button>
            ) : (
              <ScoreEntry
                total={d.pointsPerMatch}
                teamA={`You + ${nameOf(partner)}`}
                teamB={teamNames(opponents, nameOf)}
                initialA={myTeam === "a" ? myMatch.scoreA : myMatch.scoreB}
                busy={busyKey === `score-${myMatch.id}`}
                onSubmit={(mine, theirs) =>
                  run(`score-${myMatch.id}`, async () => {
                    const [a, b] = myTeam === "a" ? [mine, theirs] : [theirs, mine];
                    await Api.score(myMatch.id, a, b);
                    setEditing(false);
                  })
                }
              />
            )}
          </>
        )}

        {myMatch.status === "submitted" && submittedByMyTeam && (
          <p className="text-center text-sm text-muted">
            {scoreLine} submitted — waiting for {teamNames(opponents, nameOf)} to confirm.
          </p>
        )}

        {myMatch.status === "submitted" && !submittedByMyTeam && (
          <div className="space-y-2">
            <p className="text-center text-sm text-ink">
              They submitted <span className="font-black text-navy">{scoreLine}</span>
              {outcome && ` — a ${outcome} for you`}. Look right?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button busy={busyKey === `confirm-${myMatch.id}`} onClick={() => run(`confirm-${myMatch.id}`, () => Api.confirmScore(myMatch.id))}>
                ✓ Confirm
              </Button>
              <Button variant="danger" busy={busyKey === `dispute-${myMatch.id}`} onClick={() => run(`dispute-${myMatch.id}`, () => Api.disputeScore(myMatch.id))}>
                Dispute
              </Button>
            </div>
          </div>
        )}

        {myMatch.status === "disputed" && <p className="text-center text-sm font-semibold text-rose-dark">Score disputed — the organizer will settle it.</p>}

        {myMatch.status === "confirmed" && (
          <div className="text-center">
            <p className="text-lg font-black text-navy">Final: {scoreLine} ✓</p>
            {outcome && (
              <p className="text-xs font-semibold text-muted">
                {outcome === "win" ? "You won 🎉" : outcome === "loss" ? "Good game — on to the next one" : "A tie"}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function RoundHistory({ rounds, nameOf }: { rounds: RoundRow[]; nameOf: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button className="flex w-full items-center justify-between" onClick={() => setOpen((o) => !o)}>
        <h3 className="text-lg font-black text-navy">Previous rounds</h3>
        <span className="text-faint">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          {[...rounds].reverse().map((r) => (
            <div key={r.id}>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">Round {r.number}</p>
              <div className="space-y-1 text-sm">
                {r.matches.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-ink">
                      {teamNames(m.a, nameOf)} <span className="text-faint">vs</span> {teamNames(m.b, nameOf)}
                    </span>
                    <span className="tabular shrink-0 font-black text-navy">{m.scoreA != null ? `${m.scoreA}–${m.scoreB}` : "—"}</span>
                  </div>
                ))}
                {r.byes.length > 0 && <p className="text-xs text-muted">Sat out: {r.byes.map(nameOf).join(", ")}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CompleteView({ d, isOrganizer, run, busyKey }: ViewProps) {
  const nameOf = useNameOf(d);
  const { share, copied } = useShare(d);
  const table = d.teamStandings ?? d.standings;
  const podium = table.filter((r) => r.ranked).slice(0, 3);
  return (
    <div className="space-y-4">
      {podium.length > 0 && (
        <Card className="border-lime bg-lime-soft/60 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Final result</p>
          <p className="mt-2 text-3xl">🏆</p>
          <div className="mt-1 flex justify-center">
            {podium[0].members ? (
              <span className="flex -space-x-3">
                {podium[0].members.map((id) => (
                  <Avatar key={id} name={nameOf(id)} size="lg" ring />
                ))}
              </span>
            ) : (
              <Avatar name={podium[0].name} size="lg" ring />
            )}
          </div>
          <p className="mt-2 text-2xl font-black text-navy">{podium[0].name}</p>
          <p className="text-sm text-muted">
            {podium[0].points} points · {perGame(podium[0])} per game
          </p>
          {podium.length > 1 && (
            <div className="mt-4 flex justify-center gap-6 text-sm font-semibold text-ink">
              {podium[1] && (
                <span>
                  🥈 {podium[1].name} · {podium[1].points}
                </span>
              )}
              {podium[2] && (
                <span>
                  🥉 {podium[2].name} · {podium[2].points}
                </span>
              )}
            </div>
          )}
          <Button className="mt-5 w-full" onClick={share}>
            {copied ? (
              "✓ Results copied — paste them in your group chat"
            ) : (
              <>
                <ShareIcon />
                Share results
              </>
            )}
          </Button>
        </Card>
      )}
      <Card>
        <SectionHeader title="Standings" />
        <StandingsTable standings={table.filter((s) => s.played > 0)} highlightId={d.myPlayerId} />
      </Card>
      <RoundHistory rounds={d.rounds} nameOf={nameOf} />
      {isOrganizer && (
        <Button variant="outline" busy={busyKey === "reopen"} onClick={() => run("reopen", () => Api.sessionAction(d.id, "reopen"))}>
          Reopen session
        </Button>
      )}
    </div>
  );
}
