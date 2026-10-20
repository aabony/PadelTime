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
  CopyButton,
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
import { LevelSelect } from "../components/LevelSelect";
import { GroupByLevelToggle } from "../components/GroupByLevelToggle";
import { TeamsToggle } from "../components/TeamsToggle";
import { PartnerSelect } from "../components/PartnerSelect";
import { NightSummary } from "../components/NightSummary";
import { FORMAT_META, blurbFor, formatMeta } from "../../shared/formatMeta";

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

      {d.status !== "cancelled" && <RulesCard d={d} />}

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

function PillLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className="flex h-10 items-center gap-1 rounded-full bg-white px-3 text-xs font-bold text-navy shadow-md ring-1 ring-line hover:bg-canvas"
    >
      {children}
    </a>
  );
}

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
      ? { title: `${d.name} — results`, text: resultsText({ name: d.name, standings: d.teamStandings ?? d.standings }, `${window.location.origin}/board/${d.inviteCode}`) }
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
  const shareable = ["open", "checkin", "active", "complete"].includes(d.status);
  return (
    <div>
      {/* Back arrow, then the action row with Share on the far right. On phones the
          row drops to its own line and the banner grows with it, so it never slides
          under the card. */}
      <div className="court-banner relative min-h-36 rounded-3xl px-3 pb-16 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3">
          <Link to="/app" aria-label="Back to sessions" className="shrink-0">
            <span className="flex size-10 items-center justify-center rounded-full bg-white text-navy shadow-md">←</span>
          </Link>
          <div className="ml-auto flex flex-wrap justify-end gap-1.5">
            {d.status !== "draft" && d.status !== "cancelled" && (
              <PillLink href={`/board/${d.inviteCode}`} label="Open the live TV board in a new tab">
                📺 TV board
              </PillLink>
            )}
            {isOrganizer && (
              <PillLink href={`/print?session=${d.id}`} label="Printable pen & paper sheet">
                🖨 Print
              </PillLink>
            )}
            {shareable && <ShareButton d={d} />}
          </div>
        </div>
      </div>
      <Card className="relative -mt-12 mx-3 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={statusTone(d.status)}>
              {d.status === "checkin" && d.rounds.length > 0 ? "Paused" : SESSION_STATUS_LABEL[d.status]}
            </Badge>
            {d.mixedPairs && <Badge tone="zinc">👩👨 Mixed pairs</Badge>}
            {d.groupByLevel && <Badge tone="zinc">🎚️ Grouped by level</Badge>}
            {d.fixedTeams && <Badge tone="zinc">🤝 Fixed teams</Badge>}
          </div>
          {isOrganizer && (
            <button
              type="button"
              aria-label="Settings"
              title="Session settings — style, courts, points, time"
              onClick={onSettings}
              className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-canvas px-3 text-xs font-bold text-navy hover:bg-line"
            >
              ⚙ Settings
            </button>
          )}
        </div>
        <h1 className="mt-2 text-2xl font-black leading-tight tracking-tight text-navy">{d.name}</h1>
        <p className="mt-1 text-sm text-muted">{fmtTimeRange(d.startsAt, d.durationMin)}</p>
        {d.venue && <p className="text-sm text-muted">📍 {d.venue}</p>}
        <div className="mt-4 grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 border-t border-line pt-4">
          <StatCell label="Format" value={formatMeta(d.format).name} />
          <StatCell label="Points" value={d.pointsPerMatch} />
          <StatCell label="Courts" value={d.courts} />
          <StatCell label="Time" value={d.durationMin ? `${d.durationMin}m` : "—"} />
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The session journey: Players → Check-in → Play → Results

const STEPS = [
  { label: "Players", statuses: ["draft", "open"] },
  { label: "Check-in", statuses: ["checkin"] },
  { label: "Play", statuses: ["active"] },
  { label: "Results", statuses: ["complete"] },
] as const;

function LifecycleStepper({ d, isOrganizer, run, busyKey }: ViewProps) {
  if (d.status === "cancelled") return null;
  const current = STEPS.findIndex((s) => (s.statuses as readonly string[]).includes(d.status));

  const advance = (target: number) => {
    if (!isOrganizer || target <= current || busyKey) return;
    if (d.status === "active" && target === 3) {
      if (window.confirm("Finish the session and lock the final standings?")) {
        run("finish", () => Api.sessionAction(d.id, "complete"));
      }
      return;
    }
    if (target === 1) run("checkin", () => Api.sessionAction(d.id, "start_checkin"));
    if (target === 2) run("start", () => Api.sessionAction(d.id, "start"));
  };

  return (
    <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-1 py-1">
      {STEPS.map((s, i) => {
        const done = i < current;
        const cur = i === current;
        const reach = current === 0 ? 2 : 1;
        const clickable = isOrganizer && i > current && i - current <= reach && d.status !== "complete";
        return (
          <Fragment key={s.label}>
            {i > 0 && <span className={cls("h-px w-3 shrink-0 sm:w-8", done || cur ? "bg-royal" : "bg-line-strong")} />}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => advance(i)}
              title={clickable ? `Go to ${s.label}` : undefined}
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
              {s.label}
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
            {open ? "Format · scoring · serving · winning" : "Tap to read how the night works"}
          </span>
        </span>
        <span className="flex h-8 shrink-0 items-center rounded-full bg-canvas px-3 text-xs font-bold text-navy">
          {open ? "Hide ▴" : "Read ▾"}
        </span>
      </button>
      {open && (
        <div className="mt-3 divide-y divide-line border-t border-line">
          {d.fixedTeams ? (
            <InfoRow icon="🤝">
              <b>Same partner all night.</b>{" "}
              {d.format === "mexicano"
                ? "After each round the top two teams (points per game) play on court 1, the next two on court 2 — winners play winners."
                : "Your team meets a different team every round."}
            </InfoRow>
          ) : d.format === "mexicano" ? (
            <InfoRow icon="🏆">
              <b>Play your level.</b> After each round the top four (points per game) play on court 1, the next four on
              court 2 — 1st & 4th vs 2nd & 3rd, so games stay close.
            </InfoRow>
          ) : (
            <InfoRow icon="🔄">
              <b>New partner every round</b> — it's you against the field.
            </InfoRow>
          )}
          {d.groupByLevel && (
            <InfoRow icon="🎚️">
              <b>Grouped by level</b> — beginners play beginners
              {d.format === "mexicano"
                ? ` for their first ${d.fixedTeams ? "game" : "two games"}, then results decide.`
                : ", intermediate and advanced play each other."}
            </InfoRow>
          )}
          {d.mixedPairs && (
            <InfoRow icon="👩👨">
              <b>Mixed pairs</b> — one woman + one man per team when possible.
            </InfoRow>
          )}
          <InfoRow icon="🎯">
            <b>Games to {n} points.</b> Every rally scores; the game ends when the scores add up to {n} (e.g. {example}).
          </InfoRow>
          <InfoRow icon="🎾">
            <b>Serve 4 points each</b>, top team first, then pass it on. Switch ends at {half}.
          </InfoRow>
          <InfoRow icon="🏁">
            <b>Most points wins{d.fixedTeams ? " — as a team" : ""}.</b> Sit-outs rotate fairly{d.fixedTeams ? " (partners sit together)" : ""}; ties are allowed.
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
            grouped={form.groupByLevel}
            teams={form.fixedTeams}
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
            <Input type="number" min={1} max={12} value={form.courts} onChange={(e) => setForm({ ...form, courts: num(e.target.value, d.courts) })} />
          </Field>
          <Field label="Max players">
            <Input type="number" min={4} max={64} value={form.maxPlayers} onChange={(e) => setForm({ ...form, maxPlayers: num(e.target.value, d.maxPlayers) })} />
          </Field>
          <Field label="Points">
            <Input type="number" min={4} max={99} disabled={pointsLocked} value={form.pointsPerMatch} onChange={(e) => setForm({ ...form, pointsPerMatch: num(e.target.value, d.pointsPerMatch) })} />
          </Field>
        </div>
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
              Every team is one woman + one man whenever the numbers allow. Players say which they are when they join;
              you can set it in the roster. Applies from the next round.
            </span>
          </span>
        </label>
        <GroupByLevelToggle checked={form.groupByLevel} onChange={(groupByLevel) => setForm({ ...form, groupByLevel })} />
        <TeamsToggle checked={form.fixedTeams} disabled={pointsLocked} onChange={(fixedTeams) => setForm({ ...form, fixedTeams })} />
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
                maxPlayers: form.maxPlayers,
                pointsPerMatch: form.pointsPerMatch,
                format: form.format,
                mixedPairs: form.mixedPairs,
                groupByLevel: form.groupByLevel,
                fixedTeams: form.fixedTeams,
              });
              onClose();
            })
          }
        >
          Save changes
        </Button>
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <a href={`/board/${d.inviteCode}`} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm">📺 Open TV board</Button>
          </a>
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
  const boardUrl = `${window.location.origin}/board/${d.inviteCode}`;
  return (
    <Card>
      <SectionHeader title="Invite players" />
      <p className="mb-3 text-sm text-muted">Drop this link in the group chat — players sign up themselves.</p>
      <div className="mb-3 truncate rounded-2xl bg-canvas px-3 py-2.5 font-mono text-xs text-royal">{joinUrl}</div>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={joinUrl} label="Copy join link" variant="primary" />
        <CopyButton text={boardUrl} label="Copy TV board link" />
      </div>
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
function LevelHint({ d, players }: { d: SessionDetail; players: PlayerRow[] }) {
  const set = players.filter((p) => p.level != null).length;
  return (
    <p className="-mt-1 mb-3 rounded-xl bg-canvas px-3 py-2 text-xs text-muted">
      🎚️ Levels: <b className={set < players.length ? "text-amber-dark" : "text-navy"}>{set}</b> of {players.length} set
      {set < players.length && " (unset counts as intermediate)"} ·{" "}
      {d.format === "mexicano"
        ? "each player's first two games put beginners together and intermediate/advanced together."
        : "beginners play beginners, intermediate and advanced play each other."}{" "}
      Only you see levels.
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

function PlayersCard({ d, isOrganizer, run, busyKey, checkinMode = false }: ViewProps & { checkinMode?: boolean }) {
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
      <p className="mb-3 text-xs text-muted">
        {courts === 0
          ? inCount < 4
            ? "Needs at least 4 players"
            : "Needs at least two full teams"
          : `${courts} court${courts === 1 ? "" : "s"} per round`}
        {d.counts.waitlist > 0 && ` · ${d.counts.waitlist} waitlisted`}
      </p>
      {isOrganizer && d.groupByLevel && visible.length > 0 && <LevelHint d={d} players={visible} />}
      {isOrganizer && d.fixedTeams && visible.length > 0 && <PairingHint d={d} />}

      {visible.length === 0 && <p className="py-4 text-center text-sm text-muted">Nobody yet — share the invite link or add names below.</p>}
      <ul className="divide-y divide-line">
        {visible.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2.5">
            {checkinMode && isOrganizer ? (
              <input
                type="checkbox"
                className="size-5 accent-royal"
                checked={p.status === "checked_in"}
                disabled={p.status === "waitlist"}
                onChange={() =>
                  run(`p-${p.id}`, () => Api.playerAction(d.id, p.id, p.status === "checked_in" ? "undo_checkin" : "checkin"))
                }
              />
            ) : (
              <Avatar name={p.name} size="sm" ring={p.id === d.myPlayerId} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-navy">
                {p.name}
                {!isOrganizer && <GenderBadge gender={p.gender} className="ml-1.5" />}
                {p.isGuest && <span className="ml-1.5 text-xs font-medium text-faint">guest</span>}
                {p.id === d.myPlayerId && <span className="ml-1.5 text-xs font-bold text-royal">you</span>}
              </span>
              {isOrganizer && (
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  <GenderSelect
                    value={p.gender}
                    busy={busyKey === `g-${p.id}`}
                    onChange={(gender) => run(`g-${p.id}`, () => Api.playerAction(d.id, p.id, "set_gender", { gender }))}
                  />
                  {(d.groupByLevel || d.fixedTeams) && (
                    <LevelSelect
                      value={p.level}
                      busy={busyKey === `lvl-${p.id}`}
                      onChange={(level) => run(`lvl-${p.id}`, () => Api.playerAction(d.id, p.id, "set_level", { level }))}
                    />
                  )}
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
              {playerStatusBadge(p)}
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
      {isOrganizer && !d.myPlayerId && ["draft", "open", "checkin"].includes(d.status) && (
        <div className="mt-3 border-t border-line pt-3">
          <Button variant="secondary" size="sm" busy={busyKey === "selfjoin"} onClick={() => run("selfjoin", () => Api.join(d.inviteCode))}>
            + I'm playing too
          </Button>
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
  if (!me || me.status === "dropped") return null;
  return (
    <Card className="border-royal/30 bg-royal-soft/40">
      {me.status === "waitlist" ? (
        <p className="text-sm font-semibold text-amber-dark">You're on the waitlist — you'll move up automatically if a spot opens.</p>
      ) : d.status === "checkin" && me.status === "confirmed" ? (
        <div className="flex items-center justify-between gap-3">
          <p className="font-bold text-navy">At the club?</p>
          <Button busy={busyKey === "selfcheckin"} onClick={() => run("selfcheckin", () => Api.selfCheckin(d.id))}>
            ✓ I'm here
          </Button>
        </div>
      ) : me.status === "checked_in" ? (
        <p className="text-sm font-semibold text-navy">
          {d.rounds.length > 0
            ? "You're checked in — the game resumes when the organizer deals the next round."
            : "You're checked in. Pairings drop when the organizer starts the session."}
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
    </Card>
  );
}

function StartPreview({ d, run, busyKey }: { d: SessionDetail; run?: Run; busyKey?: string | null }) {
  const ready = d.counts.confirmed + d.counts.checkedIn;
  if (ready === 0) return null;
  const canApply = run && d.myRole === "organizer" && d.rounds.length === 0;
  return (
    <div className="mt-3">
      <NightSummary
        players={d.fixedTeams ? roundCapacity(d, signedUp(d)).playable : ready}
        teams={d.fixedTeams}
        courts={d.courts}
        durationMin={d.durationMin}
        points={d.pointsPerMatch}
        onApply={canApply ? (rec) => run("rec", () => Api.updateSession(d.id, { pointsPerMatch: rec.points, courts: rec.courts })) : undefined}
        applying={busyKey === "rec"}
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
          <p className="text-sm text-muted">
            Add players by name below and start whenever you have enough — or open signup and share the invite link
            so people join themselves.
          </p>
          <StartPreview d={d} run={run} busyKey={busyKey} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button busy={busyKey === "start"} disabled={!ready} onClick={() => run("start", () => Api.sessionAction(d.id, "start"))}>
              Start session →
            </Button>
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
          <p className="text-sm text-muted">
            Start now to play with everyone who's signed up, or run check-in first so only the people actually at the
            club get scheduled.
          </p>
          <StartPreview d={d} run={run} busyKey={busyKey} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              busy={busyKey === "start"}
              disabled={roundCapacity(d, signedUp(d)).courts === 0}
              onClick={() => run("start", () => Api.sessionAction(d.id, "start"))}
            >
              Start session →
            </Button>
            <Button variant="secondary" busy={busyKey === "checkin"} onClick={() => run("checkin", () => Api.sessionAction(d.id, "start_checkin"))}>
              Start check-in
            </Button>
          </div>
        </Card>
      )}
      <PlayersCard d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />
    </div>
  );
}

function CheckinView({ d, isOrganizer, run, busyKey }: ViewProps) {
  const n = d.counts.checkedIn;
  const { courts: courtsUsed, sitting: byes } = roundCapacity(d, checkedIn(d));
  // Check-in with rounds on the books = the game is paused between rounds.
  const paused = d.rounds.length > 0;
  const nextRound = d.rounds.length + 1;
  return (
    <div className="space-y-4">
      <MyStatusCard d={d} run={run} busyKey={busyKey} />
      {isOrganizer ? (
        <Card className="border-royal/30">
          <SectionHeader title={paused ? "Game paused" : "Check-in"} />
          <p className="text-sm text-muted">
            {paused
              ? `${d.rounds.length} round${d.rounds.length === 1 ? "" : "s"} played — scores and standings are kept. Late arrivals join with the invite link, drop-outs leave, and Resume deals round ${nextRound} with whoever is checked in.`
              : "Only checked-in players get scheduled — one no-show can wreck a round otherwise."}
          </p>
          <div className="mt-3 rounded-2xl bg-canvas px-4 py-3 text-sm text-ink">
            <span className="font-black text-navy">{n}</span> checked in → <span className="font-black text-navy">{courtsUsed}</span> court
            {courtsUsed === 1 ? "" : "s"} per round
            {courtsUsed > 0 && byes > 0 && (
              <>
                {" "}
                · <span className="font-black text-navy">{byes}</span> sitting each round
              </>
            )}
            {courtsUsed === 0 && (
              <span className="font-semibold text-amber-dark">{n < 4 ? " — need at least 4" : " — need two full teams here"}</span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button busy={busyKey === "start"} disabled={courtsUsed === 0} onClick={() => run("start", () => Api.sessionAction(d.id, "start"))}>
              {paused ? `▶️ Resume · round ${nextRound}` : "Start session →"}
            </Button>
            <Button variant="secondary" busy={busyKey === "checkin_all"} onClick={() => run("checkin_all", () => Api.sessionAction(d.id, "checkin_all"))}>
              Everyone's here
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
      <PlayersCard d={d} isOrganizer={isOrganizer} run={run} busyKey={busyKey} checkinMode />
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
  const previous = d.rounds.slice(0, -1);
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
                Every round has been undone. Start a fresh round 1 with the {d.counts.checkedIn} checked-in player
                {d.counts.checkedIn === 1 ? "" : "s"}, or pause the game to change who's playing.
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

      {!isOrganizer && me && me.status === "checked_in" && current && (
        <MyMatchCard d={d} round={current} nameOf={nameOf} run={run} busyKey={busyKey} />
      )}
      {!isOrganizer && me && me.status === "confirmed" && (
        <Card className="border-royal/30 bg-royal-soft/40">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-navy">At the courts?</p>
              <p className="text-xs text-muted">Check in and you're in the rotation from the next round.</p>
            </div>
            <Button busy={busyKey === "selfcheckin"} onClick={() => run("selfcheckin", () => Api.selfCheckin(d.id))}>
              ✓ I'm here
            </Button>
          </div>
        </Card>
      )}
      {!isOrganizer && me && me.status === "waitlist" && (
        <Card className="border-amber-soft bg-amber-soft/40">
          <p className="text-sm font-semibold text-amber-dark">
            You're on the waitlist — the organizer can bring you in between rounds.
          </p>
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
              <CourtCard key={m.id} d={d} m={m} nameOf={nameOf} isOrganizer={isOrganizer} run={run} busyKey={busyKey} />
            ))}
          </div>
          {current.byes.length > 0 && (
            <p className="mt-3 text-sm text-muted">
              <span className="font-bold text-navy">Sitting this round:</span> {current.byes.map(nameOf).join(" · ")}
            </p>
          )}
        </Card>
      )}

      {isOrganizer && current && (
        <Card>
          <SectionHeader title="Organizer controls" />
          <div className="flex flex-wrap gap-2">
            <Button
              busy={busyKey === "next"}
              onClick={() => {
                if (!current.complete && !window.confirm("Some scores aren't confirmed yet. Generate the next round anyway?")) return;
                run("next", () => Api.nextRound(d.id, { force: !current.complete }));
              }}
            >
              Next round →
            </Button>
            {!current.matches.some((m) => m.status === "confirmed") && (
              <Button
                variant="secondary"
                busy={busyKey === "regen"}
                onClick={() => {
                  if (window.confirm("Throw away these pairings and draw new ones?")) run("regen", () => Api.nextRound(d.id, { regenerate: true }));
                }}
              >
                Redraw pairings
              </Button>
            )}
            <Button
              variant="ghost"
              busy={busyKey === "undo"}
              onClick={() => {
                if (window.confirm(`Undo round ${current.number}? Its scores will be lost.`)) run("undo", () => Api.undoRound(d.id, current.id));
              }}
            >
              Undo round
            </Button>
            <Button
              variant="secondary"
              busy={busyKey === "pause"}
              disabled={!current.complete}
              title={
                current.complete
                  ? "Back to check-in between rounds — every round and the standings are kept"
                  : "Enter all of this round's scores first"
              }
              onClick={() => run("pause", () => Api.sessionAction(d.id, "pause"))}
            >
              ⏸ Pause game
            </Button>
            <Button
              variant="outline"
              busy={busyKey === "finish"}
              onClick={() => {
                if (window.confirm("Finish the session and lock the final standings?")) run("finish", () => Api.sessionAction(d.id, "complete"));
              }}
            >
              Finish session
            </Button>
            <a href={`/board/${d.inviteCode}`} target="_blank" rel="noreferrer">
              <Button variant="secondary">📺 TV board</Button>
            </a>
            <Button variant="ghost" onClick={scrollToPlayers}>
              Manage players ↓
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted">
            {formatMeta(d.format).emoji} <b className="text-navy">{formatMeta(d.format).style}</b> style ·{" "}
            {d.fixedTeams && "Team "}
            {formatMeta(d.format).name}: {blurbFor(d.format, d)}{" "}
            <button
              type="button"
              className="font-bold text-royal hover:underline"
              disabled={busyKey === "style"}
              onClick={() => run("style", () => Api.updateSession(d.id, { format: d.format === "mexicano" ? "americano" : "mexicano" }))}
            >
              Switch to {FORMAT_META[d.format === "mexicano" ? "americano" : "mexicano"].style.toLowerCase()} →
            </button>{" "}
            (applies from the next round).
          </p>
          <p className="mt-2 text-xs text-muted">
            Put the TV board on a courtside iPad or TV — it refreshes itself with courts, scores and the leaderboard.
            Late arrivals can join with the invite link at any time; player changes apply from the next round. Pause
            between rounds for a fresh check-in.
          </p>
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
        {d.counts.confirmed > 0 && ` · ${d.counts.confirmed} not checked in`}
      </p>
      {isOrganizer && d.groupByLevel && <LevelHint d={d} players={d.players.filter((p) => p.status !== "dropped" && p.status !== "waitlist")} />}
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
                            {(d.groupByLevel || d.fixedTeams) && (
                              <LevelSelect
                                compact
                                value={p.level}
                                busy={busyKey === `lvl-${p.id}`}
                                onChange={(level) => run(`lvl-${p.id}`, () => Api.playerAction(d.id, p.id, "set_level", { level }))}
                              />
                            )}
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
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] text-muted">
                          {!isOrganizer && <GenderBadge gender={p.gender} />}
                          <span>{p.status === "checked_in" ? "playing" : "not checked in"}</span>
                          {!isOrganizer && d.fixedTeams && partnerOf(d, p) && (
                            <span className="whitespace-nowrap">· 🤝 with {partnerOf(d, p)!.name}</span>
                          )}
                          {row.played > 0 && <span className="whitespace-nowrap">· {perGame(row)} per game</span>}
                          {row.played > 0 && !row.ranked && <span className="whitespace-nowrap">· too few games to rank</span>}
                          {row.byes > 0 && <span className="whitespace-nowrap">· sat out {row.byes}</span>}
                          <span className="whitespace-nowrap sm:hidden">
                            · {row.wins}-{row.losses}
                            {row.ties > 0 ? `-${row.ties}` : ""}
                          </span>
                        </div>
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
                        {p.status === "confirmed" && (
                          <Button
                            size="sm"
                            variant="subtle"
                            busy={busyKey === `p-${p.id}`}
                            onClick={() => run(`p-${p.id}`, () => Api.playerAction(d.id, p.id, "checkin"))}
                          >
                            Check in
                          </Button>
                        )}
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

function CourtCard({
  d,
  m,
  nameOf,
  isOrganizer,
  run,
  busyKey,
}: {
  d: SessionDetail;
  m: MatchRow;
  nameOf: (id: string) => string;
  isOrganizer: boolean;
  run: Run;
  busyKey: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const scored = m.scoreA != null && m.scoreB != null;
  return (
    <>
      <button
        className={cls(
          "rounded-2xl border border-line bg-canvas/60 p-4 text-left transition-colors",
          isOrganizer && "hover:border-royal hover:bg-royal-soft/40",
        )}
        onClick={() => isOrganizer && setEditing(true)}
        disabled={!isOrganizer}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-2xl font-black uppercase tracking-tight text-royal">
            <span aria-hidden>🏟️</span>
            <span>Court {m.court}</span>
          </span>
          <MatchStatusBadge m={m} />
        </div>
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
        {isOrganizer && <p className="mt-2 text-xs text-faint">{scored ? "Tap to edit score" : "Tap to enter score"}</p>}
      </button>
      <Modal open={editing} onClose={() => setEditing(false)} title={`Court ${m.court} — score`}>
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
    </>
  );
}

function MyMatchCard({
  d,
  round,
  nameOf,
  run,
  busyKey,
}: {
  d: SessionDetail;
  round: RoundRow;
  nameOf: (id: string) => string;
  run: Run;
  busyKey: string | null;
}) {
  const me = d.myPlayerId!;
  const myMatch = round.matches.find((m) => [...m.a, ...m.b].includes(me));
  const [editing, setEditing] = useState(false);

  if (!myMatch) {
    const sitting = round.byes.includes(me);
    return (
      <Card className="border-amber-soft bg-amber-soft/40 text-center">
        <p className="text-3xl">{sitting ? "🧘" : "👋"}</p>
        <p className="mt-1 font-black text-navy">
          {sitting ? `You're sitting round ${round.number} out` : `You're in from round ${round.number + 1}`}
        </p>
        <p className="text-sm text-muted">
          {sitting
            ? "Grab a drink — sit-outs rotate fairly, so you'll be back on soon."
            : `Round ${round.number} was already dealt when you joined — sit-outs rotate fairly, so you'll be on soon.`}
        </p>
      </Card>
    );
  }

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
        <span aria-hidden>🏟️</span> COURT {myMatch.court}
      </p>
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
                Enter final score
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
