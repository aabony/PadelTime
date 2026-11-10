import { courtLabel } from "../../shared/courts";
import { cls } from "./ui";

const selectCls =
  "h-9 rounded-xl border border-line-strong bg-white px-2 text-sm font-black text-navy outline-none focus:border-royal focus:ring-4 focus:ring-royal/15 disabled:opacity-50";

/**
 * "Beginner court" — the session toggle, shared by the new-session form and
 * Settings. One court (the organizer picks which; the first rented court by
 * default) is reserved for the players the organizer tags as newbies; they
 * rotate among themselves and keep their own table.
 */
export function BeginnerCourtToggle({
  checked,
  onChange,
  disabled = false,
  courts,
  courtLabels = [],
  courtNo,
  onCourtChange,
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
            Court {name} is for the players you tag as newbies: they play each other and keep their own table. Everyone else plays the
            ladder on the other courts. Only you move someone across.
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
    </div>
  );
}

/** "Competitive sit-outs": after everyone has three games, the bottom of each pool sits instead of the fair rotation. */
export function CompetitiveToggle({ checked, onChange, note }: { checked: boolean; onChange: (on: boolean) => void; note?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-3.5 py-3">
      <input type="checkbox" className="mt-0.5 size-5 accent-royal" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-bold text-navy">🏁 Competitive sit-outs</span>
        <span className="block text-xs text-muted">
          Once everyone has played 3 games, whoever is lowest on the table sits out instead of taking turns. Winners play more.
          {note && ` ${note}`}
        </span>
      </span>
    </label>
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
      title={checked ? "Newbie — plays the beginner court. Tap to move up to the ladder." : "Tap to tag as a newbie (plays the beginner court)"}
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
