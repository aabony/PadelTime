import { LEVELS, levelMeta } from "../../shared/levels";
import { cls } from "./ui";

/**
 * The organizer's level picker for any player (Newbie / Beginner / Intermediate /
 * Advanced). A native select so it's one tap on a phone.
 */
export function LevelSelect({
  value,
  onChange,
  busy = false,
  compact = false,
}: {
  value: number | null;
  onChange: (level: number | null) => void;
  busy?: boolean;
  /** Short labels (🌱 Beg) for tight tables. */
  compact?: boolean;
}) {
  const meta = levelMeta(value);
  return (
    <select
      aria-label="Level"
      title="Playing level — only you can see this. New plays the beginner court."
      disabled={busy}
      value={meta?.value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className={cls(
        "h-7 rounded-full border px-2 text-xs font-bold outline-none focus:ring-2 focus:ring-royal/30 disabled:opacity-50",
        meta ? "border-line bg-canvas text-navy" : "border-dashed border-amber-dark/50 bg-white text-amber-dark",
      )}
    >
      <option value="">{compact ? "— lvl —" : "— level —"}</option>
      {LEVELS.map((l) => (
        <option key={l.value} value={l.value}>
          {l.emoji} {compact ? l.short : l.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A player's own level. Two looks:
 * - "list" (the default): one row per level, top to bottom, with what that
 *   level means beside it — for the profile and the join page, where people
 *   are deciding which one they are.
 * - "grid": compact buttons with just the name — for tight spots where the
 *   level is already known and only being adjusted.
 */
export function LevelToggle({
  value,
  onChange,
  busy = false,
  layout = "list",
}: {
  value: number | null;
  onChange: (level: number | null) => void;
  busy?: boolean;
  layout?: "list" | "grid";
}) {
  const current = levelMeta(value)?.value ?? null;
  if (layout === "grid") {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Your level">
        {LEVELS.map((l) => {
          const on = current === l.value;
          return (
            <button
              key={l.value}
              type="button"
              aria-pressed={on}
              aria-label={l.label}
              disabled={busy}
              onClick={() => onChange(on ? null : l.value)}
              className={cls(
                "flex h-14 flex-col items-center justify-center rounded-2xl border px-1 text-xs font-bold transition-colors disabled:opacity-50",
                on ? "border-royal bg-royal text-white" : "border-line bg-white text-navy hover:border-line-strong",
              )}
            >
              <span className="text-base leading-none">{l.emoji}</span>
              <span className="mt-1">{l.label}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="space-y-2" role="group" aria-label="Your level">
      {LEVELS.map((l) => {
        const on = current === l.value;
        return (
          <button
            key={l.value}
            type="button"
            aria-pressed={on}
            aria-label={l.label}
            aria-description={l.blurb}
            disabled={busy}
            onClick={() => onChange(on ? null : l.value)}
            className={cls(
              "flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
              on ? "border-royal bg-royal text-white" : "border-line bg-white text-navy hover:border-line-strong",
            )}
          >
            <span className="flex w-[7.5rem] shrink-0 items-center gap-2 text-sm font-black">
              <span className="text-lg leading-none" aria-hidden>
                {l.emoji}
              </span>
              {l.label}
            </span>
            <span className={cls("min-w-0 text-xs leading-snug", on ? "text-white/90" : "text-muted")}>{l.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}
