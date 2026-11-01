import { cls } from "./ui";

/**
 * "Beginner court" — the session toggle, shared by the new-session form and
 * Settings. Court 1 (the first court rented) is reserved for the players the
 * organizer tags as newbies; they rotate among themselves and keep their own table.
 */
export function BeginnerCourtToggle({
  checked,
  onChange,
  disabled = false,
  courtName,
  note,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** Hidden-feature state: Keep teams together already decides who plays with whom. */
  disabled?: boolean;
  /** The first court's name ("2" when the rented courts are 2, 3, 4). */
  courtName?: string;
  note?: string;
}) {
  return (
    <label className={cls("flex items-start gap-3 rounded-2xl border border-line px-3.5 py-3", disabled ? "opacity-60" : "cursor-pointer")}>
      <input type="checkbox" className="mt-0.5 size-5 accent-royal" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-bold text-navy">🌱 Beginner court</span>
        <span className="block text-xs text-muted">
          Court {courtName ?? "1"} is for the players you tag as newbies: they play each other and keep their own table. Everyone else plays the
          ladder on the other courts. Only you move someone across.
          {note && ` ${note}`}
        </span>
      </span>
    </label>
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
export function NewbieToggle({ checked, onChange, busy = false }: { checked: boolean; onChange: (on: boolean) => void; busy?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Newbie"
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
