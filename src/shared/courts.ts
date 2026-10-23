// The courts actually rented, e.g. "3, 4": matches keep court 1..n internally,
// and every screen shows the rented number instead.

/** Court names from a form or the database: "3, 4", "3 4" or ["3", "4"]. At most 12, each up to 8 characters. */
export function parseCourtLabels(input: unknown): string[] {
  const text = typeof input === "string" ? input : "";
  const parts = Array.isArray(input) ? input.map(String) : text.includes(",") ? text.split(",") : text.split(/\s+/);
  return parts
    .map((p) => p.trim().slice(0, 8))
    .filter(Boolean)
    .slice(0, 12);
}

/** Exactly `count` names: extra ones dropped, missing ones numbered on from the highest. */
export function fitCourtLabels(labels: string[], count: number): string[] {
  if (labels.length === 0) return [];
  const out = labels.slice(0, count);
  let next = Math.max(out.length, ...out.map((l) => Number(l)).filter(Number.isFinite)) + 1;
  while (out.length < count) {
    while (out.includes(String(next))) next++;
    out.push(String(next++));
  }
  return out;
}

/** What players call court `court` (1-based): the rented name, else its number. */
export function courtLabel(labels: readonly string[] | null | undefined, court: number): string {
  return labels?.[court - 1] ?? String(court);
}
