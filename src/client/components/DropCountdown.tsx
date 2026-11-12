import { dropCountdown } from "../../shared/drop";
import { cls } from "./ui";

/**
 * The drop, counted down on the live screen: sit-outs take turns up to the
 * organizer's round, then the lowest points per game sit. One segment per fair
 * round — done, being played, still to come — and the flag at the end.
 */
export function DropCountdown({
  afterRound,
  playingRound,
  spots,
  sitting,
}: {
  afterRound: number;
  /** The round being played now. */
  playingRound: number;
  /** How many play each round. */
  spots: number;
  /** How many sit each round. */
  sitting: number;
}) {
  const c = dropCountdown(afterRound, playingRound);
  const on = c.state === "on";
  const headline = on ? "The drop is on" : c.state === "last" ? "Last round before the drop" : `${c.roundsLeft} rounds to the drop`;
  const detail = on
    ? `The top ${spots} on points per game play each round. The other ${sitting} sit out.`
    : `Sit-outs take turns through round ${afterRound}. From round ${afterRound + 1} the top ${spots} on points per game play and the other ${sitting} sit out.`;
  return (
    <div
      className={cls("rounded-2xl px-4 py-3", on ? "bg-navy text-white" : "border border-line bg-white")}
      data-testid="drop-countdown"
      data-state={c.state}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className={cls("text-xs font-black uppercase tracking-wider", on ? "text-lime" : "text-muted")}>🏁 The drop</p>
        {!on && (
          <p className="tabular text-xs font-bold text-muted">
            Round {Math.min(Math.max(playingRound, 1), afterRound)} of {afterRound}
          </p>
        )}
      </div>
      <p className={cls("mt-0.5 text-lg font-black leading-tight", on ? "text-white" : "text-navy")}>{headline}</p>
      <div
        className="mt-2 flex items-center gap-1"
        role="img"
        aria-label={on ? "The drop is on" : `${c.done} of ${afterRound} rounds played before the drop`}
      >
        {Array.from({ length: afterRound }, (_, i) => (
          <span
            key={i}
            className={cls(
              "h-2 flex-1 rounded-full",
              on ? "bg-lime" : i < c.done ? "bg-royal" : i === c.done ? "animate-pulse bg-royal/50" : "bg-line",
            )}
          />
        ))}
        <span className={cls("ml-1 text-base leading-none", !on && "opacity-40")}>🏁</span>
      </div>
      <p className={cls("mt-2 text-xs", on ? "text-white/80" : "text-muted")}>{detail}</p>
    </div>
  );
}
