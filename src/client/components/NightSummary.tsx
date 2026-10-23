import { useState } from "react";
import { compareGameLengths, rosterWarnings, sweetSpot } from "../../shared/timing";
import type { GameLengthOption } from "../../shared/timing";
import { cls } from "./ui";

const range = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

/**
 * Setting up a night: for this many players, courts and court time, how each
 * game length plays out — rounds, games and sit-outs per player — side by side,
 * with the best even option starred. Tapping a row picks it, where allowed.
 */
export function NightSummary({
  players,
  courts,
  durationMin,
  points,
  label = "players",
  onPick,
  applying = false,
  teams = false,
  idle = 0,
  folded = false,
}: {
  players: number;
  courts: number;
  durationMin: number | null | undefined;
  points: number;
  label?: string;
  /** When given, tapping a game length picks it. */
  onPick?: (points: number) => void;
  applying?: boolean;
  /** Keep teams together: the team rotation mixes the two halves, so no split warning. */
  teams?: boolean;
  /** Signed up but can't play (no partner here): not in the plan, sitting every round. */
  idle?: number;
  /** Start with just the chosen length's line; the comparison opens on a tap. */
  folded?: boolean;
}) {
  const [open, setOpen] = useState(!folded);
  const total = players + idle;
  if (players < 4) {
    return (
      <div className="rounded-2xl bg-canvas px-4 py-3 text-sm text-ink">
        <span className="font-black text-navy">{total}</span> {label} —{" "}
        <span className="font-semibold text-amber-dark">need at least 4 to start</span>
      </div>
    );
  }
  const courtsUsed = Math.min(courts, Math.floor(players / 4));
  const sitting = total - courtsUsed * 4;
  const rows = compareGameLengths(players, courts, durationMin, points);
  // Best: everyone plays the same number of games (5+ rounds, 3+ games), most play overall.
  const best = rows
    .filter((r) => r.even && r.rounds >= 5 && r.playMin >= 3)
    .reduce<GameLengthOption | null>((b, r) => (!b || r.playMin * r.points > b.playMin * b.points ? r : b), null);
  const warn = rosterWarnings(players, courts);
  const spot = sweetSpot(courts);

  return (
    <div className="rounded-2xl bg-canvas p-3 text-sm text-ink">
      <p className="px-1">
        <span className="font-black text-navy">{total}</span> {label} · <span className="font-black text-navy">{courtsUsed}</span>{" "}
        court{courtsUsed === 1 ? "" : "s"} →{" "}
        {sitting > 0 ? (
          <>
            <span className="font-black text-navy">{sitting}</span> sit out each round
          </>
        ) : (
          "nobody sits out"
        )}
        {courtsUsed < courts && <span className="text-muted"> (fills {courtsUsed} of {courts} courts)</span>}
      </p>

      {rows.length > 0 && !open ? (
        (() => {
          const now = rows.find((r) => r.points === points);
          return (
            <button type="button" onClick={() => setOpen(true)} className="mt-1 w-full px-1 text-left text-xs text-muted">
              {now && (
                <>
                  <b className="text-navy">{points} pts</b> → {now.rounds} rounds, {teams ? "each team" : "everyone"} plays{" "}
                  <b className={now.even ? "text-mint-dark" : "text-navy"}>{range(now.playMin, now.playMax)}</b>
                  {now.even && " ✓"} ·{" "}
                </>
              )}
              <span className="font-bold text-royal">Compare game lengths ▾</span>
            </button>
          );
        })()
      ) : rows.length > 0 ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-line bg-white" data-testid="game-lengths">
          <div className="grid grid-cols-[1fr_3.5rem_3.25rem_2.5rem] gap-x-2 whitespace-nowrap border-b border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span>Game to</span>
            <span className="text-right">Rounds</span>
            <span className="text-right">Games</span>
            <span className="text-right">Sits</span>
          </div>
          {rows.map((r) => {
            const picked = r.points === points;
            const Row = onPick ? "button" : "div";
            return (
              <Row
                key={r.points}
                {...(onPick ? { type: "button" as const, disabled: applying, onClick: () => onPick(r.points), "aria-pressed": picked } : {})}
                className={cls(
                  "grid w-full grid-cols-[1fr_3.5rem_3.25rem_2.5rem] items-center gap-x-2 border-b border-line px-3 py-2 text-left last:border-b-0",
                  picked ? "bg-royal-soft/70" : onPick && "hover:bg-canvas",
                )}
              >
                <span className="min-w-0 whitespace-nowrap leading-tight">
                  <span className={cls("font-black", picked ? "text-royal" : "text-navy")}>{r.points} pts</span>
                  {best?.points === r.points && <span className="ml-1.5 text-xs font-bold text-mint-dark">★ best</span>}
                  <span className="block text-[11px] text-muted">~{r.minutesPerMatch} min a game</span>
                </span>
                <span className="tabular text-right font-semibold text-navy">{r.rounds}</span>
                <span className={cls("tabular text-right font-bold", r.even ? "text-mint-dark" : "text-navy")}>
                  {range(r.playMin, r.playMax)}
                  {r.even && sitting > 0 && " ✓"}
                </span>
                <span className="tabular text-right text-muted">{range(r.sitMin, r.sitMax)}</span>
              </Row>
            );
          })}
        </div>
      ) : (
        <p className="mt-1 px-1 text-xs text-muted">Set the court time to compare game lengths.</p>
      )}
      {rows.length > 0 && open && (
        <p className="mt-1.5 px-1 text-xs text-muted">
          Games and sit-outs per {teams ? "team" : "player"} in a {durationMin}-min booking (~10 min to get going). ✓ = everyone
          gets the same number of games.
          {onPick && " Tap a row to use it."}
        </p>
      )}

      {idle > 0 && (
        <p className="mt-2 px-1 text-xs font-semibold text-amber-dark">
          ⚠️ {idle} without a partner here can't play until paired — the table is for the {players} who can.
        </p>
      )}
      {warn.splitGroups && !teams && (
        <p className="mt-2 px-1 text-xs font-semibold text-amber-dark">
          ⚠️ {players} players on {courtsUsed} court{courtsUsed === 1 ? "" : "s"} splits into two groups of {courtsUsed * 4} who
          never play each other — one more or one fewer avoids it.
        </p>
      )}
      {warn.longWaits && (
        <p className="mt-2 px-1 text-xs font-semibold text-amber-dark">
          ⚠️ More than half sit out each round — expect 2–3 rounds in a row off court.
        </p>
      )}
      {(total < spot.min || total > spot.max) && (
        <p className="mt-1 px-1 text-xs text-muted">
          Sweet spot for {courts} court{courts === 1 ? "" : "s"}: {spot.min}–{spot.max} players.
        </p>
      )}
    </div>
  );
}
