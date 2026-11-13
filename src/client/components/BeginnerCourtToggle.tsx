import { courtLabel } from "../../shared/courts";
import { DROP_AFTER_CHOICES } from "../../shared/drop";
import { cls } from "./ui";

/** The newbie caps offered: one court plays 4 at a time, so 8 is four on and four waiting. */
export const NEWBIE_CAP_CHOICES = [4, 6, 8, 10, 12];
/** What a new night starts with once the beginner court is switched on. */
export const DEFAULT_NEWBIE_CAP = 8;

const selectCls =
  "h-9 rounded-xl border border-line-strong bg-white px-2 text-sm font-black text-navy outline-none focus:border-royal focus:ring-4 focus:ring-royal/15 disabled:opacity-50";

/**
 * "Beginner court" — the session toggle, shared by the new-session form and
 * Settings. One court (the organizer picks which; the first rented court by
 * default) is reserved for the players the organizer tags as newbies. Two
 * ways to run it: Games (they rotate among themselves and keep their own
 * table) or Coaching (they train with a coach and are left out of the draw
 * until the organizer untags them).
 */
export function BeginnerCourtToggle({
  checked,
  onChange,
  disabled = false,
  courts,
  courtLabels = [],
  courtNo,
  onCourtChange,
  coached,
  onCoachedChange,
  maxNewbies,
  onMaxNewbiesChange,
  note,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** Hidden-feature state: Keep teams together already decides who plays with whom. */
  disabled?: boolean;
  /** How many courts the night has. */
  courts: number;
  /** The rented names ("2", "3", "4"), when the courts aren't just 1, 2, 3. */
  courtLabels?: string[];
  /** Which court (1-based internal number) is the beginner court. */
  courtNo: number;
  onCourtChange: (courtNo: number) => void;
  /** Coaching instead of games on that court. */
  coached: boolean;
  onCoachedChange: (coached: boolean) => void;
  /** The most newbies the night takes (null = no limit): a Newbie signing up past it goes on the waitlist. */
  maxNewbies: number | null;
  onMaxNewbiesChange: (max: number | null) => void;
  note?: string;
}) {
  // A court that no longer exists (courts were reduced) falls back to the first.
  const current = Math.min(Math.max(courtNo, 1), Math.max(courts, 1));
  const name = courtLabel(courtLabels, current);
  return (
    <div className={cls("rounded-2xl border border-line px-3.5 py-3", disabled && "opacity-60")}>
      <label className={cls("flex items-start gap-3", !disabled && "cursor-pointer")}>
        <input type="checkbox" className="mt-0.5 size-5 accent-royal" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="block text-sm font-bold text-navy">🌱 Beginner court</span>
          <span className="block text-xs text-muted">
            {checked && coached
              ? `Court ${name} is for coaching: players whose level is New train there and aren't in the draw. The tournament runs on the other courts. Change someone's level to bring them in.`
              : `Court ${name} is for players whose level is New: they play each other and keep their own table. It runs on its own clock, so it never holds up the rounds on the other courts. Needs 4 newbies. Only you move someone across.`}
            {note && ` ${note}`}
          </span>
        </span>
      </label>
      {checked && !disabled && (
        <label className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-xs font-bold uppercase tracking-wider text-muted">Which court</span>
          <select
            aria-label="Beginner court"
            className={cls(selectCls, "w-28")}
            value={current}
            onChange={(e) => onCourtChange(Number(e.target.value))}
          >
            {Array.from({ length: Math.max(courts, 1) }, (_, i) => i + 1).map((c) => (
              <option key={c} value={c}>
                Court {courtLabel(courtLabels, c)}
              </option>
            ))}
          </select>
        </label>
      )}
      {checked && !disabled && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-muted">On that court</span>
          <div className="flex gap-1.5" role="group" aria-label="Beginner court mode">
            {[
              { coached: false, label: "🎾 Games" },
              { coached: true, label: "🎓 Coaching" },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={coached === o.coached}
                onClick={() => onCoachedChange(o.coached)}
                className={cls(
                  "h-9 rounded-full border px-3 text-xs font-bold transition-colors",
                  coached === o.coached ? "border-royal bg-royal text-white" : "border-line bg-white text-navy hover:border-line-strong",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {checked && !disabled && (
        <label className="mt-3 flex items-center justify-between gap-3">
          <span>
            <span className="block text-xs font-bold uppercase tracking-wider text-muted">Newbie spots</span>
            <span className="block text-xs text-muted">
              {maxNewbies == null
                ? "Any number of newbies can sign up."
                : `One court holds 4 at a time, so ${maxNewbies} means ${Math.max(0, maxNewbies - 4)} waiting. A Newbie who signs up after that goes on the waitlist.`}
            </span>
          </span>
          <select
            aria-label="Newbie spots"
            className={cls(selectCls, "w-28 shrink-0")}
            value={maxNewbies ?? 0}
            onChange={(e) => onMaxNewbiesChange(Number(e.target.value) || null)}
          >
            <option value={0}>No limit</option>
            {[...new Set([...NEWBIE_CAP_CHOICES, ...(maxNewbies ? [maxNewbies] : [])])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n} newbies
                </option>
              ))}
          </select>
        </label>
      )}
    </div>
  );
}

/**
 * "Competitive sit-outs" and its drop round: sit-outs take turns up to the
 * round the organizer picks; from the next one the bottom of the table sits.
 */
export function CompetitiveToggle({
  checked,
  onChange,
  afterRound,
  onAfterRoundChange,
  note,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** The drop: the last round with fair sit-outs. */
  afterRound: number;
  onAfterRoundChange: (round: number) => void;
  note?: string;
}) {
  // A round saved outside the usual choices still shows as picked.
  const choices = [...new Set([...DROP_AFTER_CHOICES, afterRound])].sort((a, b) => a - b);
  return (
    <div className="rounded-2xl border border-line px-3.5 py-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-0.5 size-5 accent-royal" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="block text-sm font-bold text-navy">🏁 Competitive sit-outs</span>
          <span className="block text-xs text-muted">
            {checked
              ? `Sit-outs take turns through round ${afterRound}. From round ${afterRound + 1}, whoever is lowest on points per game sits out and the top of the table keeps playing.`
              : "Sit-outs take turns for the first rounds. After the round you pick, whoever is lowest on the table sits out. Winners play more."}
            {note && ` ${note}`}
          </span>
        </span>
      </label>
      {checked && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-xs font-bold uppercase tracking-wider text-muted">Drop after round</span>
          <div className="flex gap-1.5" role="group" aria-label="Drop after round">
            {choices.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={afterRound === n}
                onClick={() => onAfterRoundChange(n)}
                className={cls(
                  "size-9 rounded-full border text-sm font-bold transition-colors",
                  afterRound === n ? "border-royal bg-royal text-white" : "border-line bg-white text-navy hover:border-line-strong",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The organizer's newbie tag on a roster row: tap to move a player to or from the beginner court. */
export function NewbieToggle({
  checked,
  onChange,
  busy = false,
  label = "Newbie",
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  busy?: boolean;
  /** Accessible name; the add-a-player forms use their own so the roster's switches stay distinct. */
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={checked ? "Newbie — plays the beginner court. Tap to move up to the ladder." : "Tap to add them as a newbie (plays the beginner court)"}
      disabled={busy}
      onClick={() => onChange(!checked)}
      className={cls(
        "h-7 rounded-full border px-2 text-xs font-bold outline-none focus:ring-2 focus:ring-royal/30 disabled:opacity-50",
        checked ? "border-mint-dark/40 bg-mint-soft text-mint-dark" : "border-line bg-white text-muted hover:text-navy",
      )}
    >
      🌱 {checked ? "Newbie" : "Newbie?"}
    </button>
  );
}
