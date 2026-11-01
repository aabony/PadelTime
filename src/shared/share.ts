import type { StandingRow } from "./types";

/**
 * The text a finished night shares to WhatsApp, iMessage…: the podium on one
 * line, then everyone's place and points, then the link to the public results
 * page. The link sits inside the text so apps that drop a separate URL keep it.
 */
export function resultsText(d: { name: string; standings: StandingRow[]; beginnerStandings?: StandingRow[] }, url: string): string {
  const table = (rows: StandingRow[]) => {
    const played = rows.filter((r) => r.played > 0);
    const ranked = played.filter((r) => r.ranked);
    const unranked = played.filter((r) => !r.ranked);
    return [
      ...ranked.map((r, i) => `${i + 1}. ${r.name} ${r.points}`),
      ...unranked.map((r) => `– ${r.name} ${r.points} (too few games)`),
    ];
  };
  const podium = d.standings
    .filter((r) => r.played > 0 && r.ranked)
    .slice(0, 3)
    .map((r, i) => `${["🥇", "🥈", "🥉"][i]} ${r.name} ${r.points}`)
    .join(" · ");
  const beginners = d.beginnerStandings?.some((r) => r.played > 0) ? ["", "🌱 Beginner court", ...table(d.beginnerStandings)] : [];
  const lines = [`🏆 ${d.name} — final results`, ...(podium ? [podium] : []), "", ...table(d.standings), ...beginners, "", `Full results: ${url}`];
  return lines.join("\n");
}
