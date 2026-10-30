/**
 * Swapping one player for another in a round that's on court. The player
 * coming in can be sitting out, on another court (the two trade places), or
 * not in the round at all — a late arrival — in which case the one going out
 * sits the round. Only games without a score can change.
 */

export interface SwapMatch {
  id: string;
  /** Slots in order: a1, a2, b1, b2. */
  slots: [string, string, string, string];
  scored: boolean;
}

export interface SwapResult {
  /** Matches whose slots changed, with their new slots. */
  matches: SwapMatch[];
  byes: string[];
}

export function swapInRound(
  matches: SwapMatch[],
  byes: string[],
  out: string,
  inn: string,
): SwapResult | { error: string } {
  if (out === inn) return { error: "Pick two different players" };
  const outMatch = matches.find((m) => m.slots.includes(out));
  if (!outMatch) return { error: "That player isn't on a court this round" };
  const inMatch = matches.find((m) => m.slots.includes(inn));
  if (outMatch.scored || inMatch?.scored) return { error: "That game already has a score" };
  if (inMatch === outMatch) return { error: "They're already in the same game" };

  const replace = (m: SwapMatch, from: string, to: string): SwapMatch => ({
    ...m,
    slots: m.slots.map((p) => (p === from ? to : p)) as SwapMatch["slots"],
  });
  const changed = [replace(outMatch, out, inn)];
  let nextByes = byes;
  if (inMatch) changed.push(replace(inMatch, inn, out));
  else if (byes.includes(inn)) nextByes = byes.map((p) => (p === inn ? out : p));
  else nextByes = [...byes, out];
  return { matches: changed, byes: nextByes };
}

/**
 * Keep teams together: swap a whole team for another — sitting out, on
 * another court, or just arrived — so nobody is split from their partner.
 * `outs` are the two partners going off, `ins` the two coming on, in order.
 */
export function swapTeamsInRound(
  matches: SwapMatch[],
  byes: string[],
  outs: [string, string],
  ins: [string, string],
): SwapResult | { error: string } {
  let current = matches;
  let currentByes = byes;
  for (let k = 0; k < 2; k++) {
    const step = swapInRound(current, currentByes, outs[k], ins[k]);
    if ("error" in step) return step;
    current = current.map((m) => step.matches.find((x) => x.id === m.id) ?? m);
    currentByes = step.byes;
  }
  const changed = current.filter((m, i) => m.slots.some((p, j) => p !== matches[i].slots[j]));
  return { matches: changed, byes: currentByes };
}
