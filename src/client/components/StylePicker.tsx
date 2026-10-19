import { FORMAT_KEYS, FORMAT_META, blurbFor } from "../../shared/formatMeta";
import type { FormatKey } from "../../shared/types";
import { cls } from "./ui";

/** Casual (Americano) vs Competitive (Mexicano) — the one choice that changes how courts are dealt. */
export function StylePicker({
  value,
  onChange,
  hint,
  grouped = false,
  teams = false,
}: {
  value: FormatKey;
  onChange: (key: FormatKey) => void;
  hint?: string;
  /** "Group players by playing level" is ticked: describe the grouped version. */
  grouped?: boolean;
  /** "Keep teams together" is ticked: describe the team version. */
  teams?: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-navy">Style</p>
      <div className="grid grid-cols-2 gap-2">
        {FORMAT_KEYS.map((key) => {
          const m = FORMAT_META[key];
          const on = key === value;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(key)}
              className={cls(
                "rounded-2xl border p-3 text-left transition-colors",
                on ? "border-royal bg-royal-soft/60 ring-2 ring-royal/30" : "border-line bg-white hover:border-line-strong",
              )}
            >
              <p className="font-black text-navy">
                {m.emoji} {m.style}
              </p>
              <p className="text-xs font-bold text-royal">
                {teams && "Team "}
                {m.name} · {m.tagline}
              </p>
              <p className="mt-1 text-xs leading-snug text-muted">{blurbFor(key, { groupByLevel: grouped, fixedTeams: teams })}</p>
            </button>
          );
        })}
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
