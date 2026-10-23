import { cls } from "./ui";

/**
 * "Keep teams together" — the session toggle, shared by the new-session form
 * and Settings.
 */
export function TeamsToggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** Locked once a round has been dealt: team standings count every game as a team's game. */
  disabled?: boolean;
}) {
  return (
    <label className={cls("flex items-start gap-3 rounded-2xl border border-line px-3.5 py-3", disabled ? "opacity-60" : "cursor-pointer")}>
      <input
        type="checkbox"
        className="mt-0.5 size-5 accent-royal"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-bold text-navy">🤝 Keep teams together</span>
        <span className="block text-xs text-muted">
          Partners play the whole night together. Pair them in the roster; the rest are paired for you.
        </span>
      </span>
    </label>
  );
}
