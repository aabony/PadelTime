import type { DB } from "./detail";
import { loadPlayers, loadRounds, loadSessionByCode } from "./detail";
import { computeStandings, pointsPerGame } from "../../shared/standings";
import { formatMeta } from "../../shared/formatMeta";

// Link previews (WhatsApp, iMessage, Slack…) read the HTML, not the app, so
// the Worker rewrites the SPA shell's <title>/og:* tags for shared links:
// the invite link reads as "<session> · sign up", the TV board as live scores.
export interface PageMeta {
  title: string;
  description: string;
}

export async function previewFor(db: DB, kind: "join" | "board", code: string): Promise<PageMeta | null> {
  const loaded = await loadSessionByCode(db, code);
  if (!loaded) return null;
  const { session } = loaded;
  const players = await loadPlayers(db, session.id);
  const rounds = await loadRounds(db, session.id);
  const format = formatMeta(session.format);
  const standings = computeStandings(players, rounds).filter((s) => s.ranked);
  const podium = standings
    .slice(0, 3)
    .map((s, i) => `${["🥇", "🥈", "🥉"][i]} ${s.name} ${pointsPerGame(s).toFixed(1)}/game`)
    .join(" · ");
  const inCount = players.filter((p) => p.status === "confirmed" || p.status === "checked_in").length;
  const current = rounds[rounds.length - 1];

  if (kind === "join") {
    if (session.status === "complete") {
      return { title: `${session.name} · final standings`, description: podium || "Session finished." };
    }
    if (session.status === "cancelled") {
      return { title: session.name, description: "This session was cancelled." };
    }
    const bits = [
      `${format.name} · ${session.pointsPerMatch}-point games`,
      session.mixedPairs ? "mixed pairs" : null,
      session.venue,
      `${inCount}/${session.maxPlayers} players in`,
      session.status === "active" ? `round ${current?.number ?? 1} on court — join and you're dealt in next round` : "tap to sign up",
    ].filter(Boolean);
    return { title: `${session.name} · sign up`, description: bits.join(" · ") };
  }

  // TV board
  if (session.status === "complete") {
    return { title: `${session.name} · final standings`, description: podium || "Session finished." };
  }
  if (current) {
    return {
      title: `${session.name} · live scores`,
      description: `Round ${current.number}${podium ? ` · ${podium}` : ""}`,
    };
  }
  return { title: `${session.name} · live scores`, description: `${format.name} night · waiting for the first round.` };
}
