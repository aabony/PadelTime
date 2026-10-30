import { cls } from "./ui";

/**
 * "Keep teams together" — the session toggle, shared by the new-session form
 * and Settings.
 */
export function TeamsToggle({
  checked,
  onChange,
  disabled = false,
  note,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  /** Extra line under the description, e.g. "Applies from the next round." */
  note?: string;
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
          {note && ` ${note}`}
        </span>
      </span>
    </label>
  );
}
