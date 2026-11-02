import { NIGHT_TYPES, NIGHT_TYPE_KEYS, nightTypeOf } from "../../shared/nightTypes";
import type { NightTypeFlags, NightTypeKey } from "../../shared/nightTypes";
import { cls } from "./ui";

/**
 * The one question the form asks: what kind of night is it? Picking a type sets
 * the format, the beginner court and competitive sit-outs together. Switches
 * changed under Fine-tune that match no type show as "Custom".
 */
export function NightTypePicker({
  flags,
  onChange,
  hint,
  courts,
}: {
  flags: NightTypeFlags;
  onChange: (key: NightTypeKey) => void;
  hint?: string;
  /** With one court there is no beginner court: the open-night and tournament types still work, minus that court. */
  courts?: number;
}) {
  const current = nightTypeOf(flags);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="text-sm font-semibold text-navy">Night type</p>
        {current == null && <span className="text-xs font-bold text-amber-dark">Custom (see Fine-tune)</span>}
      </div>
      <div className="grid gap-2" data-testid="night-types">
        {NIGHT_TYPE_KEYS.map((key) => {
          const t = NIGHT_TYPES[key];
          const on = key === current;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(key)}
              className={cls(
                "flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
                on ? "border-royal bg-royal-soft/60 ring-2 ring-royal/30" : "border-line bg-white hover:border-line-strong",
              )}
            >
              <span className="mt-0.5 text-xl" aria-hidden>
                {t.emoji}
              </span>
              <span className="min-w-0">
                <span className="block font-black text-navy">
                  {t.name} <span className="font-bold text-royal">· {t.tagline}</span>
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">
                  {t.blurb}
                  {t.beginnerCourt && courts != null && courts < 2 && " (needs 2+ courts for the beginner court)"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** The switches behind the night type, folded away. Open by default when they match no type. */
export function FineTune({ custom, children }: { custom: boolean; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-line" open={custom}>
      <summary className="cursor-pointer select-none px-3.5 py-3 text-sm font-bold text-navy">
        🎛️ Fine-tune <span className="font-medium text-muted">— style, mixed pairs, levels, beginner court, teams</span>
      </summary>
      <div className="space-y-3 border-t border-line p-3">{children}</div>
    </details>
  );
}
