import { LEVELS, levelMeta } from "../../shared/levels";
import { cls } from "./ui";

/**
 * Organizer-only playing level (Beginner / Intermediate / Advanced). A native
 * select so it's one tap on a phone; players never see it or their level.
 */
export function LevelSelect({
  value,
  onChange,
  busy = false,
}: {
  value: number | null;
  onChange: (level: number | null) => void;
  busy?: boolean;
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
      <option value="">— level —</option>
      {LEVELS.map((l) => (
        <option key={l.value} value={l.value}>
          {l.emoji} {l.label}
        </option>
      ))}
    </select>
  );
}
