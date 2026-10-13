/**
 * "Group players by playing level" — the session toggle, shared by the
 * new-session form and Settings.
 */
export function GroupByLevelToggle({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-3.5 py-3">
      <input
        type="checkbox"
        className="mt-0.5 size-5 accent-royal"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-bold text-navy">🎚️ Group players by playing level</span>
        <span className="block text-xs text-muted">
          Beginners play beginners, intermediate and advanced play each other — so every court is a good match-up. You
          set each player's level in the roster; only you can see it. In Competitive it sets up each player's first
          game, then results take over.
        </span>
      </span>
    </label>
  );
}
