/**
 * "Keep teams together" — the session toggle, shared by the new-session form
 * and Settings.
 */
export function TeamsToggle({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-3.5 py-3">
      <input
        type="checkbox"
        className="mt-0.5 size-5 accent-royal"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-bold text-navy">🤝 Keep teams together</span>
        <span className="block text-xs text-muted">
          Pairs play the whole night together. Pair people in the roster; anyone unpaired is paired for you when rounds
          start, balanced by the levels you set (woman + man with Mixed pairs). Casual: each team meets different teams.
          Competitive: winners play winners.
        </span>
      </span>
    </label>
  );
}
