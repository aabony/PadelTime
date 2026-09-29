import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { SETUP_MINUTES, estimateRounds, minutesPerMatch, rosterSplit, sweetSpot } from "../../shared/timing";
import { Button, Card, Stepper, cls } from "../components/ui";
import { Logo } from "../App";

const SCORING = [12, 16, 24] as const;

type Tone = "nonstop" | "light" | "social" | "waiting";

const VERDICT: Record<Tone, { text: string; style: string }> = {
  nonstop: { text: "🎾 Nonstop padel — nobody sits out", style: "bg-royal-soft text-royal-dark" },
  light: { text: "Light breaks — some players never sit out", style: "bg-canvas text-navy" },
  social: { text: "🍻 Social sweet spot — everyone sits out 1–2 rounds", style: "bg-lime-soft text-navy" },
  waiting: { text: "⏳ Lots of waiting — 3+ sit-outs each", style: "bg-amber-soft text-amber-dark" },
};

/** Nonstop: nobody sits. Social: everyone sits 1–2 rounds. Light: some never sit. Waiting: 3+ sit-outs. */
function toneOf(sitMin: number, sitMax: number): Tone {
  if (sitMax === 0) return "nonstop";
  if (sitMax <= 2) return sitMin >= 1 ? "social" : "light";
  return "waiting";
}

const span = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

/**
 * Night planner: four dials — players, courts, game scoring and court time —
 * and the on-court / off-court split they produce, per round and per player.
 * The setup lives in the URL, so a planned night can be shared as a link.
 */
export function PlanPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const players = clamp(params.get("players"), 12, 4, 64);
  const courts = clamp(params.get("courts"), 2, 1, 12);
  const duration = clamp(params.get("duration"), 90, 30, 600);
  const points = snapScoring(params.get("points"));

  const set = (patch: Partial<Record<"players" | "courts" | "duration" | "points", number>>) => {
    const next = { players, courts, duration, points, ...patch };
    setParams(
      Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)])),
      { replace: true },
    );
  };

  const mpm = minutesPerMatch(points);
  const rounds = estimateRounds(duration, points) ?? 1;
  const split = rosterSplit(players, courts, rounds);
  const onCourt = split.courtsUsed * 4;
  const tone = toneOf(split.sitMin, split.sitMax);
  const onCourtPct = Math.round((onCourt / players) * 100);
  const spot = sweetSpot(courts);

  return (
    <div className="min-h-dvh bg-canvas pb-16">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
        <Logo to="/" />
        <Link to="/app" className="text-sm font-bold text-royal hover:text-royal-dark">
          My sessions →
        </Link>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-navy">Night planner</h1>
          <p className="mt-1 text-sm text-muted">
            Dial in your night and see who's on court and who's off. Timings are measured on real nights: a 24-point game
            runs about 15 minutes, a 16-point game about 11.
          </p>
        </div>

        <Card>
          <div className="divide-y divide-line">
            <Row label="Players" hint={`Sweet spot for ${courts} court${courts === 1 ? "" : "s"}: ${spot.min}–${spot.max}`}>
              <Stepper label="players" value={players} min={4} max={64} onChange={(v) => set({ players: v })} />
            </Row>
            <Row label="Courts">
              <Stepper label="courts" value={courts} min={1} max={12} onChange={(v) => set({ courts: v })} />
            </Row>
            <Row label="Game scoring" hint={`~${mpm} min per game`}>
              <div role="radiogroup" aria-label="Game scoring" className="grid grid-cols-3 gap-1 rounded-full bg-canvas p-1">
                {SCORING.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={p === points}
                    onClick={() => set({ points: p })}
                    className={cls(
                      "rounded-full px-3 py-1.5 text-sm font-black transition-colors",
                      p === points ? "bg-navy text-white shadow" : "text-navy hover:bg-white",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Court time" hint={`≈ ${Math.max(duration - SETUP_MINUTES, 0)} min of play after check-in`}>
              <Stepper label="court time" unit="min" step={15} value={duration} min={30} max={600} onChange={(v) => set({ duration: v })} />
            </Row>
          </div>
        </Card>

        <Card>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Your night</p>
          <p className="mt-1 text-2xl font-black text-navy">
            {rounds} round{rounds === 1 ? "" : "s"}
          </p>
          <p className="text-sm font-semibold text-muted">
            of {points}-point games · ~{mpm} min each
          </p>

          <div className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-sm font-bold text-navy">Each round</span>
              <span className="text-sm text-ink" data-testid="round-split">
                <b className="text-royal">{onCourt}</b> on court · <b className="text-lime-dark">{split.sittingPerRound}</b> off
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1" aria-hidden="true">
              {Array.from({ length: players }, (_, i) => (
                <span key={i} className={cls("size-3.5 rounded-full", i < onCourt ? "bg-royal" : "bg-lime ring-1 ring-lime-dark/40")} />
              ))}
            </div>
            {split.courtsUsed < courts && (
              <p className="mt-2 text-xs font-semibold text-amber-dark">
                {players} players fill {split.courtsUsed} of {courts} courts — {courts - split.courtsUsed} stay{courts - split.courtsUsed === 1 ? "s" : ""} empty.
              </p>
            )}
          </div>

          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-bold text-navy">Each player</span>
              <span className="text-sm text-ink">
                <b className="text-royal">{onCourtPct}%</b> on court
              </span>
            </div>
            <div
              className="mt-2 flex h-3 overflow-hidden rounded-full bg-lime"
              role="img"
              aria-label={`${onCourtPct}% of the night on court, ${100 - onCourtPct}% off court`}
            >
              <div className="bg-royal" style={{ width: `${onCourtPct}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-royal-soft px-3 py-2.5" data-testid="on-court">
                <p className="text-[11px] font-bold uppercase tracking-wider text-royal">On court</p>
                <p className="text-lg font-black text-navy">
                  {span(split.playMin, split.playMax)} game{split.playMax === 1 ? "" : "s"}
                </p>
                <p className="text-xs text-muted">{span(split.playMin * mpm, split.playMax * mpm)} min of padel</p>
              </div>
              <div className="rounded-2xl bg-lime-soft px-3 py-2.5" data-testid="off-court">
                <p className="text-[11px] font-bold uppercase tracking-wider text-lime-dark">Off court</p>
                <p className="text-lg font-black text-navy">
                  {split.sitMax === 0 ? (
                    <>
                      No <span className="whitespace-nowrap">sit-outs</span>
                    </>
                  ) : (
                    <>
                      {span(split.sitMin, split.sitMax)}{" "}
                      <span className="whitespace-nowrap">sit-out{split.sitMax === 1 ? "" : "s"}</span>
                    </>
                  )}
                </p>
                <p className="text-xs text-muted">
                  {split.sitMax === 0 ? "nonstop" : `${span(split.sitMin * mpm, split.sitMax * mpm)} min to socialise`}
                </p>
              </div>
            </div>
          </div>

          <p className={cls("mt-4 rounded-2xl px-3 py-2 text-sm font-bold", VERDICT[tone].style)} data-tone={tone}>
            {VERDICT[tone].text}
          </p>

          <Button
            className="mt-4 w-full"
            size="lg"
            onClick={() => navigate(`/app?new=1&players=${players}&courts=${courts}&points=${points}&duration=${duration}`)}
          >
            Create this session →
          </Button>
        </Card>
      </main>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  // Label on the left (its hint wraps under it), control pinned right, on every width.
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-navy">{label}</p>
        {hint && <p className="text-xs leading-snug text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function snapScoring(raw: string | null): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 16;
  return SCORING.reduce((best, p) => (Math.abs(p - n) < Math.abs(best - n) ? p : best), SCORING[0]);
}

function clamp(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
