import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { americano } from "../../shared/formats/americano";
import { formatMeta } from "../../shared/formatMeta";
import { mulberry32 } from "../../shared/formats/types";
import type { EngineContext } from "../../shared/formats/types";
import { buildHistory, creditAbsences } from "../../shared/history";
import type { HistoryRound } from "../../shared/history";
import type { SessionDetail } from "../../shared/types";
import { estimateRounds } from "../../shared/timing";
import { Api, useLoad } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { Button, ErrorNote, PageSpinner, cls } from "../components/ui";

// Pen & paper mode: a one-page, print-optimised Americano sheet.
//
// Two flavours share one layout:
//  - anonymous (/print?players=12&courts=3…): numbered blanks, names written in
//  - session   (/print?session=<id>):        real names pre-filled, rounds the
//    app already generated (and any scores entered) printed as-is, and further
//    rounds planned ahead from that history — so paper can take over mid-night.
// Either way the pairing engine pre-computes the schedule by player number.

function clampInt(v: string | null, def: number, min: number, max: number): number {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
}

interface SheetMatch {
  court: number;
  a: [number, number];
  b: [number, number];
  scoreA: number | null;
  scoreB: number | null;
}
interface SheetRound {
  number: number;
  byes: number[];
  matches: SheetMatch[];
}
interface SheetData {
  title: string;
  subtitle: string;
  when: string | null;
  venue: string | null;
  players: { number: number; name: string | null }[];
  courts: number;
  points: number;
  rounds: SheetRound[];
  format: "americano" | "mexicano";
}

/** Plan rounds prior.length+1 … totalRounds, honouring everything already played. */
function planRounds(
  ids: string[],
  courts: number,
  totalRounds: number,
  seed: number,
  prior: HistoryRound[],
  extra: Partial<EngineContext> = {},
): HistoryRound[] {
  const history = [...prior];
  const planned: HistoryRound[] = [];
  const rng = mulberry32(seed || 1);
  for (let r = prior.length + 1; r <= totalRounds; r++) {
    const ctx: EngineContext = {
      players: ids,
      courts,
      roundNumber: r,
      ...creditAbsences(buildHistory(history), history, ids),
      standings: [],
      ...extra,
      rng,
    };
    const plan = americano.planRound(ctx);
    const round: HistoryRound = {
      number: r,
      byes: plan.byes,
      matches: plan.matches.map((m) => ({ a: m.a, b: m.b })),
    };
    history.push(round);
    planned.push(round);
  }
  return planned;
}

function anonymousSheet(players: number, courts: number, rounds: number, points: number, seed: number): SheetData {
  const ids = Array.from({ length: players }, (_, i) => `${i + 1}`);
  const planned = planRounds(ids, courts, rounds, seed, []);
  return {
    title: "PadelTime · AMERICANO",
    subtitle: `${players} players · ${courts} court${courts === 1 ? "" : "s"}`,
    when: null,
    venue: null,
    players: ids.map((id) => ({ number: Number(id), name: null })),
    courts,
    points,
    format: "americano",
    rounds: planned.map((r) => ({
      number: r.number,
      byes: r.byes.map(Number).sort((a, b) => a - b),
      matches: r.matches.map((m, i) => ({
        court: i + 1,
        a: [Number(m.a[0]), Number(m.a[1])],
        b: [Number(m.b[0]), Number(m.b[1])],
        scoreA: null,
        scoreB: null,
      })),
    })),
  };
}

/** Mexicano deals courts from the standings, so future rounds can't be pre-planned: print blank courts to fill in. */
function blankRounds(from: number, to: number, courts: number): SheetRound[] {
  const out: SheetRound[] = [];
  for (let r = from; r <= to; r++) {
    out.push({
      number: r,
      byes: [],
      matches: Array.from({ length: courts }, (_, i) => ({ court: i + 1, a: [0, 0], b: [0, 0], scoreA: null, scoreB: null })),
    });
  }
  return out;
}

/** Same level grouping as the live engine (levels only reach the organizer's view). */
function groupingFor(d: SessionDetail): Partial<EngineContext> {
  if (!d.groupByLevel) return {};
  const levels: Record<string, number> = {};
  for (const p of d.players) if (p.level != null) levels[p.id] = p.level;
  return { groupByLevel: true, levels };
}

function sessionSheet(d: SessionDetail, roundsWanted: number, seed: number): SheetData | { error: string } {
  const played = new Set<string>();
  for (const r of d.rounds) {
    r.byes.forEach((id) => played.add(id));
    r.matches.forEach((m) => [...m.a, ...m.b].forEach((id) => played.add(id)));
  }
  // Roster order = join order; dropped players stay only if they already played.
  const roster = d.players.filter(
    (p) => p.status !== "waitlist" && (p.status !== "dropped" || played.has(p.id)),
  );
  if (roster.length < 4) {
    return { error: "Need at least 4 confirmed players to build a schedule." };
  }
  const numberOf = new Map(roster.map((p, i) => [p.id, i + 1]));
  const num = (id: string) => numberOf.get(id) ?? 0;
  const byNumber = (ids: string[]) => ids.map(num).filter(Boolean).sort((a, b) => a - b);

  const existing: SheetRound[] = d.rounds.map((r) => ({
    number: r.number,
    byes: byNumber(r.byes),
    matches: r.matches.map((m) => ({
      court: m.court,
      a: [num(m.a[0]), num(m.a[1])],
      b: [num(m.b[0]), num(m.b[1])],
      scoreA: m.scoreA,
      scoreB: m.scoreB,
    })),
  }));
  const prior: HistoryRound[] = d.rounds.map((r) => ({
    number: r.number,
    byes: r.byes,
    matches: r.matches.map((m) => ({ a: m.a, b: m.b })),
  }));
  const activeIds = roster.filter((p) => p.status !== "dropped").map((p) => p.id);
  const totalRounds = Math.max(roundsWanted, existing.length);
  const planned: SheetRound[] =
    activeIds.length < 4
      ? []
      : d.format === "mexicano"
        ? blankRounds(existing.length + 1, totalRounds, Math.min(d.courts, Math.floor(activeIds.length / 4)))
        : planRounds(activeIds, d.courts, totalRounds, seed, prior, groupingFor(d)).map((r) => ({
          number: r.number,
          byes: byNumber(r.byes),
          matches: r.matches.map((m, i) => ({
            court: i + 1,
            a: [num(m.a[0]), num(m.a[1])] as [number, number],
            b: [num(m.b[0]), num(m.b[1])] as [number, number],
            scoreA: null,
            scoreB: null,
          })),
        }));

  return {
    title: d.name,
    subtitle: `${d.groupName} · ${formatMeta(d.format).name} · ${roster.length} players · ${d.courts} court${d.courts === 1 ? "" : "s"}`,
    when: d.startsAt ? fmtDateTime(d.startsAt) : null,
    venue: d.venue,
    players: roster.map((p, i) => ({ number: i + 1, name: p.name })),
    courts: d.courts,
    points: d.pointsPerMatch,
    rounds: [...existing, ...planned],
    format: d.format,
  };
}

export function PrintSheetPage() {
  const [params, setParams] = useSearchParams();
  const sessionId = params.get("session");
  const seed = clampInt(params.get("seed"), 1, 1, 999999);
  // Anonymous-mode ranges are capped to what stays writable on one A4 page.
  const players = clampInt(params.get("players"), 12, 4, 16);
  const courts = clampInt(params.get("courts"), 3, 1, 4);
  const points = clampInt(params.get("points"), 24, 4, 99);

  const session = useLoad(() => (sessionId ? Api.session(sessionId) : Promise.resolve(null)), [sessionId]);

  // Session mode defaults the round count to what fits the booked court time.
  const estimated = session.data ? estimateRounds(session.data.durationMin, session.data.pointsPerMatch) : null;
  const rounds = clampInt(params.get("rounds"), Math.min(Math.max(estimated ?? 6, 3), 8), 3, 8);

  const set = (key: string, value: number) => {
    const next = new URLSearchParams(params);
    next.set(key, String(value));
    setParams(next, { replace: true });
  };

  const built = useMemo<SheetData | { error: string } | null>(() => {
    if (sessionId) return session.data ? sessionSheet(session.data, rounds, seed) : null;
    return anonymousSheet(players, courts, rounds, points, seed);
  }, [sessionId, session.data, players, courts, rounds, points, seed]);

  const sheet = built && !("error" in built) ? built : null;
  const buildError = built && "error" in built ? built.error : null;

  const byeRounds = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const r of sheet?.rounds ?? []) {
      for (const b of r.byes) {
        if (!map.has(b)) map.set(b, new Set());
        map.get(b)!.add(r.number);
      }
    }
    return map;
  }, [sheet]);

  const hasNames = !!sheet?.players.some((p) => p.name);
  const dense = (sheet?.players.length ?? 0) > 12 || (sheet?.rounds.length ?? 0) > 6;
  const numInput =
    "w-16 rounded-xl border border-line-strong bg-white px-2 py-1.5 text-center text-sm text-ink outline-none focus:border-royal";
  const field = (label: string, key: string, value: number, min: number, max: number) => (
    <label key={key} className="block text-center">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <input
        type="number"
        className={numInput}
        min={min}
        max={max}
        value={value}
        onChange={(e) => set(key, clampInt(e.target.value, value, min, max))}
      />
    </label>
  );

  return (
    <div className="min-h-dvh bg-canvas print:bg-white">
      {/* Controls — never printed */}
      <div className="no-print border-b border-line bg-white px-4 py-4">
        <div className="mx-auto flex max-w-4xl flex-wrap items-end justify-between gap-4">
          <div>
            <Link to={sessionId ? `/app/sessions/${sessionId}` : "/"} className="text-sm font-semibold text-muted hover:text-royal">
              ← {sessionId ? "Back to session" : "PadelTime"}
            </Link>
            <h1 className="text-lg font-black text-navy">
              {sessionId ? "Pen & paper sheet for this session" : "Printable Americano sheet"}
            </h1>
            {sessionId && sheet && (
              <p className="text-xs text-muted">
                Names filled in · {session.data?.rounds.length ?? 0} round{(session.data?.rounds.length ?? 0) === 1 ? "" : "s"} already
                generated by the app · the rest planned ahead
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {!sessionId && field("Players", "players", players, 4, 16)}
            {!sessionId && field("Courts", "courts", courts, 1, 4)}
            {field("Rounds", "rounds", rounds, 3, 8)}
            {!sessionId && field("Points", "points", points, 4, 99)}
            <Button variant="secondary" size="sm" onClick={() => set("seed", (seed % 999999) + 1)}>
              ↻ {sessionId ? "Redraw future rounds" : "Shuffle pairings"}
            </Button>
            <Button onClick={() => window.print()} disabled={!sheet}>
              🖨 Print / Save PDF
            </Button>
          </div>
        </div>
      </div>

      {sessionId && session.loading && <PageSpinner />}
      {sessionId && (session.error || buildError) && (
        <div className="mx-auto max-w-xl px-4 py-8">
          <ErrorNote message={session.error ?? buildError} />
          {session.error && (
            <p className="mt-3 text-sm text-muted">
              You need to be signed in as a member of this session.{" "}
              <Link className="font-bold text-royal" to={`/login?next=${encodeURIComponent(`/print?session=${sessionId}`)}`}>
                Sign in
              </Link>
            </p>
          )}
        </div>
      )}

      {sheet && (
        <div className="mx-auto my-6 max-w-4xl px-4 print:my-0 print:max-w-none print:px-0">
          <div className="sheet mx-auto bg-white p-6 text-zinc-900 shadow-2xl print:p-0 print:shadow-none">
            {/* Header */}
            <div className="flex items-end justify-between border-b-2 border-zinc-900 pb-2">
              <div>
                <p className="text-xl font-black tracking-tight">🎾 {sheet.title}</p>
                <p className="text-[11px] text-zinc-600">
                  {sheet.subtitle} · {sheet.rounds.length} rounds · <b>{sheet.points} points per match</b>
                </p>
                <p className="text-[11px] font-semibold text-zinc-700">
                  {hasNames ? "Players are numbered below." : "Fill the player list first (name + initials)."} Matchups show
                  player numbers (#) — score in the empty boxes as you play.
                </p>
              </div>
              <div className="text-right text-[11px] text-zinc-700">
                <p className="mb-2">Date {sheet.when ? <b>{sheet.when}</b> : "______________________"}</p>
                <p>Venue {sheet.venue ? <b>{sheet.venue}</b> : "______________________"}</p>
              </div>
            </div>

            {/* Roster: number → name → initials */}
            <div className={cls("rounded border border-zinc-300", dense ? "mt-2" : "mt-3")}>
              <div className={cls("flex items-center justify-between border-b border-zinc-300 bg-zinc-100 px-2", dense ? "py-px" : "py-0.5")}>
                <span className={cls("font-black", dense ? "text-[11px]" : "text-xs")}>PLAYERS</span>
                <span className={cls("text-zinc-600", dense ? "text-[9px]" : "text-[10px]")}>
                  {hasNames ? "initials □" : "name ................ initials □"}
                </span>
              </div>
              <div className={cls("grid px-2", sheet.players.length > 12 ? "grid-cols-4 gap-x-3" : "grid-cols-2 gap-x-5", dense ? "py-1" : "py-1.5")}>
                {sheet.players.map((p) => (
                  <div key={p.number} className={cls("flex items-center gap-1.5", dense ? "py-px" : "py-[3px]")}>
                    <span className={cls("tabular w-6 shrink-0 text-right font-black", dense ? "text-[10px]" : "text-[11px]")}>
                      #{p.number}
                    </span>
                    <span
                      className={cls(
                        "min-w-0 flex-1 truncate border-b border-zinc-400 font-semibold leading-none",
                        dense ? "h-3 text-[10px]" : "h-3.5 text-[11px]",
                      )}
                    >
                      {p.name ?? ""}
                    </span>
                    <span className={cls("shrink-0 rounded-[2px] border border-zinc-400", dense ? "h-3 w-6" : "h-4 w-7")} />
                  </div>
                ))}
              </div>
            </div>

            {/* Schedule */}
            <div className={cls("grid gap-x-5", dense ? "mt-2 gap-y-1" : "mt-3 gap-y-2", sheet.rounds.length > 4 ? "grid-cols-2" : "grid-cols-1")}>
              {sheet.rounds.map((round) => (
                <div key={round.number} className="break-inside-avoid rounded border border-zinc-300">
                  <div className={cls("flex items-center justify-between border-b border-zinc-300 bg-zinc-100 px-2", dense ? "py-px" : "py-0.5")}>
                    <span className={cls("font-black", dense ? "text-[11px]" : "text-xs")}>ROUND {round.number}</span>
                    {round.byes.length > 0 && (
                      <span className={cls("text-zinc-600", dense ? "text-[9px]" : "text-[10px]")}>
                        sits: {round.byes.map((b) => `#${b}`).join(" ")}
                      </span>
                    )}
                  </div>
                  <table className="w-full">
                    <tbody>
                      {round.matches.map((m) => (
                        <tr key={m.court} className="border-t border-zinc-200 first:border-t-0">
                          <td className={cls("px-2 font-bold text-zinc-500", dense ? "py-px text-[9px]" : "py-0.5 text-[10px]")}>
                            C{m.court}
                          </td>
                          <td className={cls("tabular text-center font-bold", dense ? "py-px text-[11px]" : "py-0.5 text-xs")}>
                            <Num n={m.a[0]} /> <span className="font-normal text-zinc-400">&amp;</span> <Num n={m.a[1]} />{" "}
                            <span className="font-normal text-zinc-400">vs</span> <Num n={m.b[0]} />{" "}
                            <span className="font-normal text-zinc-400">&amp;</span> <Num n={m.b[1]} />
                          </td>
                          <td className={cls("whitespace-nowrap pr-2 text-right", dense ? "py-px" : "py-0.5")}>
                            <ScoreBox value={m.scoreA} dense={dense} />
                            <span className="mx-0.5 align-middle text-[10px] text-zinc-400">:</span>
                            <ScoreBox value={m.scoreB} dense={dense} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            {/* Tally: player + points per round + total */}
            <table className={cls("w-full border-collapse", dense ? "mt-2" : "mt-3")}>
              <thead>
                <tr>
                  <th className={cls("w-8 border border-zinc-400 bg-zinc-100 px-1 py-0.5 font-black", dense ? "text-[10px]" : "text-[11px]")}>#</th>
                  <th className={cls("border border-zinc-400 bg-zinc-100 px-2 py-0.5 text-left font-black", dense ? "w-24 text-[10px]" : "w-28 text-[11px]")}>
                    {hasNames ? "PLAYER" : "INITIALS"}
                  </th>
                  {sheet.rounds.map((r) => (
                    <th key={r.number} className={cls("border border-zinc-400 bg-zinc-100 px-1 py-0.5 font-bold", dense ? "text-[9px]" : "text-[10px]")}>
                      R{r.number}
                    </th>
                  ))}
                  <th className={cls("border border-zinc-400 bg-zinc-200 px-1 py-0.5 font-black", dense ? "w-12 text-[10px]" : "w-16 text-[11px]")}>
                    TOTAL
                  </th>
                </tr>
              </thead>
              <tbody>
                {sheet.players.map((p) => (
                  <tr key={p.number}>
                    <td className={cls("tabular border border-zinc-400 px-1 text-center font-black", dense ? "py-px text-[10px] leading-tight" : "py-1 text-[11px]")}>
                      {p.number}
                    </td>
                    <td className={cls("max-w-0 truncate border border-zinc-400 px-2 font-semibold", dense ? "text-[9px]" : "text-[10px]")}>
                      {p.name ?? ""}
                    </td>
                    {sheet.rounds.map((r) => (
                      <td key={r.number} className="tabular border border-zinc-400 text-center">
                        {byeRounds.get(p.number)?.has(r.number) ? (
                          <span className={cls("text-zinc-400", dense ? "text-[9px]" : "text-[10px]")}>—</span>
                        ) : null}
                      </td>
                    ))}
                    <td className="border border-zinc-400 bg-zinc-50" />
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-1.5 text-[9px] leading-tight text-zinc-500">
              “—” = sitting that round out. Game to {sheet.points} total points, no deuce.{" "}
              <b>Winner:</b> most points per game (Total ÷ games played; you need at least half as many games as the
              busiest player).{" "}
              {sheet.format === "mexicano" && (
                <>
                  <b>Mexicano:</b> after each round rank everyone by points — top four to court 1, next four to court 2,
                  1st & 4th vs 2nd & 3rd. Fill the blank rounds in as you go.{" "}
                </>
              )}
              <b>Serve changes every 4
              points</b> (teams alternate, each player serves 4 in a row); the first-listed pair serves first. Both partners
              write their team's score in their own row each round; highest total wins — padeltime.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Player number, or a blank to write into (Mexicano rounds that aren't dealt yet). */
function Num({ n }: { n: number }) {
  if (!n) return <span className="inline-block w-5 border-b border-zinc-400 align-baseline">&nbsp;</span>;
  return (
    <>
      <span className="font-normal text-zinc-500">#</span>
      {n}
    </>
  );
}

function ScoreBox({ value, dense }: { value: number | null; dense: boolean }) {
  return (
    <span
      className={cls(
        "tabular inline-block rounded-[2px] border border-zinc-400 text-center align-middle font-bold",
        dense ? "h-3 w-7 text-[9px] leading-[11px]" : "h-4 w-9 text-[10px] leading-[15px]",
      )}
    >
      {value ?? ""}
    </span>
  );
}
