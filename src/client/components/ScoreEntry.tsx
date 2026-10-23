import { useState } from "react";
import { Button, Stepper } from "./ui";

// One control drives both numbers: team B is always total − team A,
// because Americano matches are a fixed number of rally points.
export function ScoreEntry({
  total,
  teamA,
  teamB,
  initialA,
  onSubmit,
  busy,
  submitLabel = "Submit score",
}: {
  total: number;
  teamA: string;
  teamB: string;
  initialA?: number | null;
  onSubmit: (scoreA: number, scoreB: number) => void;
  busy?: boolean;
  submitLabel?: string;
}) {
  const [a, setA] = useState(initialA ?? Math.floor(total / 2));
  const b = total - a;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-navy">{teamA}</span>
        <Stepper value={a} onChange={setA} min={0} max={total} big />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-muted">{teamB}</span>
        <span className="inline-flex items-center gap-3">
          <span className="size-12" />
          <span className="tabular w-14 text-center text-4xl font-black text-faint">{b}</span>
          <span className="size-12" />
        </span>
      </div>
      <Button className="w-full" size="lg" busy={busy} onClick={() => onSubmit(a, b)}>
        {submitLabel} · {a}–{b}
      </Button>
    </div>
  );
}
