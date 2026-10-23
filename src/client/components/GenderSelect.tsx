import { GENDERS, genderMeta } from "../../shared/genders";
import type { Gender } from "../../shared/genders";
import { cls } from "./ui";

/** Compact woman / man picker — just the emoji (native select: one tap on a phone). */
export function GenderSelect({
  value,
  onChange,
  busy = false,
  label = "Gender",
}: {
  value: Gender | null;
  onChange: (gender: Gender | null) => void;
  busy?: boolean;
  label?: string;
}) {
  const meta = genderMeta(value);
  return (
    <select
      aria-label={label}
      title="Woman / man — used for mixed pairs"
      disabled={busy}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "woman" || e.target.value === "man" ? e.target.value : null)}
      className={cls(
        "h-7 rounded-full border px-2 text-xs font-bold outline-none focus:ring-2 focus:ring-royal/30 disabled:opacity-50",
        meta ? "border-line bg-canvas text-navy" : "border-dashed border-line-strong bg-white text-muted",
      )}
    >
      <option value="">👩/👨</option>
      {GENDERS.map((g) => (
        <option key={g.value} value={g.value} aria-label={g.label}>
          {g.emoji}
        </option>
      ))}
    </select>
  );
}

export function GenderBadge({ gender, className }: { gender: Gender | null; className?: string }) {
  const meta = genderMeta(gender);
  if (!meta) return null;
  return (
    <span className={cls("text-sm leading-none", className)} title={meta.label} aria-label={meta.label}>
      {meta.emoji}
    </span>
  );
}

/** Two big buttons for the join page / status card. */
export function GenderToggle({ value, onChange, busy = false }: { value: Gender | null; onChange: (g: Gender | null) => void; busy?: boolean }) {
  return (
    <div className="flex gap-2" role="group" aria-label="Gender">
      {GENDERS.map((g) => {
        const on = value === g.value;
        return (
          <button
            key={g.value}
            type="button"
            aria-pressed={on}
            disabled={busy}
            onClick={() => onChange(on ? null : g.value)}
            className={cls(
              "flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition-colors disabled:opacity-50",
              on ? "border-royal bg-royal text-white" : "border-line bg-white text-navy hover:border-line-strong",
            )}
          >
            {g.emoji} {g.label}
          </button>
        );
      })}
    </div>
  );
}
