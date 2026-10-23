import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { Api, usePoll } from "../lib/api";
import { StandingsTable, perGame } from "../components/StandingsTable";
import { Avatar, Badge, PageSpinner, cls } from "../components/ui";
import { formatMeta } from "../../shared/formatMeta";
import { courtLabel } from "../../shared/courts";

// TV / court display (plan §16): read-only, huge type, auto-refreshing.
export function BoardPage() {
  const { code = "" } = useParams();
  const { data, error } = usePoll(() => Api.board(code), 5000, [code]);

  const nameOf = useMemo(() => {
    const map = new Map((data?.players ?? []).map((p) => [p.id, p.name]));
    return (pid: string) => map.get(pid) ?? "?";
  }, [data?.players]);

  if (error) return <div className="flex min-h-dvh items-center justify-center bg-canvas text-muted">{error}</div>;
  if (!data) return <PageSpinner />;

  const current = data.rounds[data.rounds.length - 1];
  const done = data.status === "complete";
  const paused = data.status === "checkin" && data.rounds.length > 0;
  const table = data.teamStandings ?? data.standings;
  const champion = done ? (table.find((r) => r.ranked) ?? null) : null;

  return (
    <div className="min-h-dvh bg-canvas px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-muted">🎾 PadelTime · {formatMeta(data.format).name}</p>
            <h1 className="text-4xl font-black tracking-tight text-navy sm:text-5xl">{data.name}</h1>
          </div>
          <div className="flex items-center gap-3">
            {current && !done && !paused && (
              <span className="rounded-full bg-royal px-5 py-2 text-2xl font-black text-white">ROUND {current.number}</span>
            )}
            {paused && (
              <span className="rounded-full bg-amber-soft px-5 py-2 text-2xl font-black text-amber-dark">
                ⏸ PAUSED · {data.rounds.length} ROUND{data.rounds.length === 1 ? "" : "S"} PLAYED
              </span>
            )}
            {done && (
              <Badge tone="emerald" className="text-sm">
                FINAL
              </Badge>
            )}
          </div>
        </header>

        {champion && (
          <div className="mb-8 rounded-3xl border border-lime bg-lime-soft p-8 text-center">
            <p className="text-lg text-ink">🏆 Champion</p>
            <div className="my-2 flex justify-center">
              {champion.members ? (
                <span className="flex -space-x-3">
                  {champion.members.map((id) => (
                    <Avatar key={id} name={nameOf(id)} size="lg" ring />
                  ))}
                </span>
              ) : (
                <Avatar name={champion.name} size="lg" ring />
              )}
            </div>
            <p className="text-5xl font-black text-navy">{champion.name}</p>
            <p className="mt-1 text-muted">
              {champion.points} points · {perGame(champion)} per game
            </p>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <section>
            {current && !done ? (
              <div className="space-y-4">
                {current.matches.map((m) => (
                  <div key={m.id} className="rounded-3xl border border-line bg-white p-6">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-2xl font-black uppercase tracking-tight text-royal">
                        <span aria-hidden>🏟️</span>
                        <span>Court {courtLabel(data.courtLabels, m.court)}</span>
                      </span>
                      <span className={cls("text-xs font-bold uppercase tracking-wider", m.status === "confirmed" ? "text-mint-dark" : "text-muted")}>
                        {m.status === "confirmed" ? "✓ complete" : m.status === "submitted" || m.status === "disputed" ? "confirming…" : "live"}
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2">
                      <p className="truncate text-2xl font-bold text-navy">
                        {nameOf(m.a[0])} + {nameOf(m.a[1])}
                      </p>
                      <p className="tabular text-4xl font-black text-navy">{m.scoreA ?? "–"}</p>
                      <p className="truncate text-2xl font-bold text-navy">
                        {nameOf(m.b[0])} + {nameOf(m.b[1])}
                      </p>
                      <p className="tabular text-4xl font-black text-navy">{m.scoreB ?? "–"}</p>
                    </div>
                  </div>
                ))}
                {current.byes.length > 0 && (
                  <p className="text-lg text-muted">
                    <span className="font-bold text-navy">SITTING:</span> {current.byes.map(nameOf).join("  ·  ")}
                  </p>
                )}
              </div>
            ) : !done ? (
              <div className="rounded-3xl border border-dashed border-line-strong p-10 text-center text-muted">Waiting for the first round…</div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-line bg-white p-6">
            <h2 className="mb-4 text-xl font-black text-navy">Leaderboard</h2>
            <StandingsTable standings={table} compact />
          </section>
        </div>

        <footer className="mt-10 text-center text-sm text-faint">🎾 PadelTime · {data.pointsPerMatch} points per match</footer>
      </div>
    </div>
  );
}
