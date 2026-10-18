import { useState } from "react";
import { SETUP_MINUTES, planNight, recommendSetup, rosterWarnings, sweetSpot } from "../../shared/timing";
import type { Priority, Recommendation } from "../../shared/timing";
import { cls } from "./ui";

/**
 * "What you get": rounds, matches and breaks per player for a roster size,
 * courts, court time and points — with a suggestion for the chosen priority
 * (playing time vs socialising) and, where the caller allows, a one-tap apply.
 */
export function NightSummary({
  players,
  courts,
  durationMin,
  points,
  label = "players",
  onApply,
  applying = false,
}: {
  players: number;
  courts: number;
  durationMin: number | null | undefined;
  points: number;
  label?: string;
  /** When given, the suggestion comes with a "Use" button. */
  onApply?: (rec: Recommendation) => void;
  applying?: boolean;
}) {
  const [priority, setPriority] = useState<Priority>("playing");
  const p = planNight(players, courts, durationMin, points);
  const spot = sweetSpot(courts);
  if (players < 4) {
    return (
      <div className="rounded-2xl bg-canvas px-4 py-3 text-sm text-ink">
        <span className="font-black text-navy">{players}</span> {label} —{" "}
        <span className="font-semibold text-amber-dark">need at least 4 to start</span>
      </div>
    );
  }
  // Courts can only be suggested downwards from what's available (social mode).
  const rec = recommendSetup(players, courts, durationMin, priority);
  const differs = rec && (rec.points !== points || rec.courts !== p.courtsUsed);
  const recPlan = rec ? planNight(players, rec.courts, durationMin, rec.points) : null;
  const warn = rosterWarnings(players, courts);
  return (
    <div className="rounded-2xl bg-canvas px-4 py-3 text-sm text-ink">
      <p>
        <span className="font-black text-navy">{players}</span> {label} → <span className="font-black text-navy">{p.courtsUsed}</span>{" "}
        court{p.courtsUsed === 1 ? "" : "s"} per round
        {p.sitting > 0 ? (
          <>
            {" "}
            · <span className="font-black text-navy">{p.sitting}</span> sitting each round
          </>
        ) : (
          <span className="text-muted"> · nobody sits out</span>
        )}
      </p>
      {p.rounds != null && p.courtsUsed > 0 && (
        <p className="mt-1 text-xs text-muted">
          {durationMin} min (≈ {Math.max((durationMin ?? 0) - SETUP_MINUTES, 0)} of play after check-in) of {points}-point games ≈{" "}
          <span className="font-bold text-navy">{p.rounds} rounds</span> of ~{p.minutesPerMatch} min · each player plays ~
          <span className="font-bold text-navy">{p.matchesPerPlayer}</span>
          {p.sitting > 0 ? (
            <>
              {" "}
              and sits out ~<span className="font-bold text-navy">{p.sitOutsPerPlayer}</span> (a sit-out is one round, ≈{" "}
              {p.minutesPerMatch} min)
            </>
          ) : (
            <> — no breaks until the end</>
          )}
          .
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Priority:</span>
        {(
          [
            ["playing", "🎾 Playing time"],
            ["social", "🍻 Socialising"],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            type="button"
            aria-pressed={priority === key}
            onClick={() => setPriority(key)}
            className={cls(
              "rounded-full border px-2.5 py-1 font-bold transition-colors",
              priority === key ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-line-strong",
            )}
          >
            {text}
          </button>
        ))}
      </div>
      {rec && recPlan && differs ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-navy">
            💡 Suggested: {rec.courts} court{rec.courts === 1 ? "" : "s"} · {rec.points}-point games
            {rec.stopAfter != null ? (
              <> → stop after round {rec.stopAfter}</>
            ) : (
              rec.rounds != null && <> → {rec.rounds} rounds</>
            )}
            {rec.gamesEach != null && rec.rounds != null && recPlan.sitting > 0 ? (
              <>
                {" "}
                — everyone plays {rec.gamesEach} and sits out {rec.rounds - rec.gamesEach}
              </>
            ) : recPlan.sitting > 0 ? (
              <>
                , {recPlan.sitting} sit each round (≈ {recPlan.minutesPerMatch} min breaks)
              </>
            ) : (
              <>, nobody sits out</>
            )}
            .
          </span>
          {onApply && (
            <button
              type="button"
              disabled={applying}
              onClick={() => onApply(rec)}
              className="rounded-full bg-royal px-3 py-1 font-bold text-white hover:bg-royal-dark disabled:opacity-50"
            >
              Use this
            </button>
          )}
        </p>
      ) : (
        rec &&
        rec.equalGames && (
          <p className="mt-2 text-xs font-semibold text-mint-dark">
            ✓ This is the suggested setup for {priority === "social" ? "socialising" : "playing time"}
            {rec.gamesEach != null && recPlan && recPlan.sitting > 0 && <> — everyone plays {rec.gamesEach}</>}.
          </p>
        )
      )}
      {warn.splitGroups && (
        <p className="mt-2 text-xs font-semibold text-amber-dark">
          ⚠️ {players} players on {p.courtsUsed} court{p.courtsUsed === 1 ? "" : "s"} splits into two groups of {p.onCourt} who never
          play each other — one more or one fewer avoids it.
        </p>
      )}
      {warn.longWaits && (
        <p className="mt-2 text-xs font-semibold text-amber-dark">
          ⚠️ More than half sit out each round — expect 2–3 rounds in a row off court and short games.
        </p>
      )}
      {rec && !rec.equalGames && durationMin ? (
        <p className="mt-2 text-xs font-semibold text-amber-dark">
          ⚠️ Games can't come out even for {players} players — some get one more game than others.
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted">
        Sweet spot for {courts} court{courts === 1 ? "" : "s"}: {spot.min}–{spot.max} players — a few rest each round,
        nobody waits long.
      </p>
    </div>
  );
}
