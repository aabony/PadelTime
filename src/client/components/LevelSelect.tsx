import { LEVELS, levelMeta } from "../../shared/levels";
import { cls } from "./ui";

/**
 * The organizer's level picker for any player (Beginner / Intermediate /
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
      title="Playing level — only you can see this"
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

/** A player's own level: three buttons for the join page / status card. */
export function LevelToggle({
  value,
  onChange,
  busy = false,
}: {
  value: number | null;
  onChange: (level: number | null) => void;
  busy?: boolean;
}) {
  const current = levelMeta(value)?.value ?? null;
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Your level">
      {LEVELS.map((l) => {
        const on = current === l.value;
        return (
          <button
            key={l.value}
            type="button"
            aria-pressed={on}
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
