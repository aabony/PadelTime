import type { PlayerRow } from "../../shared/types";
import { cls } from "./ui";

/**
 * Keep teams together: the organizer's pick of a player's partner. "auto"
 * leaves them to be paired when the next round is dealt. Picking someone who
 * already has a partner moves them over (their old partner goes back to auto).
 */
export function PartnerSelect({
  player,
  players,
  onChange,
  busy = false,
}: {
  player: PlayerRow;
  /** The roster, to pick from (dropped players are left out). */
  players: PlayerRow[];
  onChange: (partnerId: string | null) => void;
  busy?: boolean;
}) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const others = players.filter((p) => p.id !== player.id && p.status !== "dropped");
  const partner = player.partnerId ? byId.get(player.partnerId) : undefined;
  return (
    <select
      aria-label={`${player.name}'s partner`}
      title="Partner for the whole night"
      disabled={busy}
      value={partner ? partner.id : ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={cls(
        "h-7 max-w-40 rounded-full border px-2 text-xs font-bold outline-none focus:ring-2 focus:ring-royal/30 disabled:opacity-50",
        partner ? "border-line bg-canvas text-navy" : "border-dashed border-line-strong bg-white text-muted",
      )}
    >
      <option value="">🤝 auto partner</option>
      {others.map((p) => {
        const theirs = p.partnerId && p.partnerId !== player.id ? byId.get(p.partnerId) : undefined;
        return (
          <option key={p.id} value={p.id}>
            🤝 {p.name}
            {theirs ? ` (with ${theirs.name})` : ""}
          </option>
        );
      })}
    </select>
  );
}
