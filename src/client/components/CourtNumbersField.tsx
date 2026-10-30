import { fitCourtLabels, parseCourtLabels } from "../../shared/courts";
import { cls } from "./ui";

/** Courts a night can use from the dropdown (more only if a session already has them). */
const COURT_COUNTS = [1, 2, 3, 4, 5, 6];
const NUMBERS = Array.from({ length: 12 }, (_, i) => String(i + 1));

const selectCls =
  "h-10 rounded-xl border border-line-strong bg-white px-2 text-sm font-black text-navy outline-none focus:border-royal focus:ring-4 focus:ring-royal/15";

/**
 * How many courts (a dropdown), then which ones are booked — one number
 * dropdown per court, so players see Court 3 / Court 4 instead of 1, 2.
 * Nothing to type: picking a number another court already has swaps them.
 */
export function CourtNumbersField({
  courts,
  value,
  onChange,
}: {
  courts: number;
  value: string;
  onChange: (value: string, courts: number) => void;
}) {
  const saved = parseCourtLabels(value);
  const numbers = saved.length ? fitCourtLabels(saved, courts) : NUMBERS.slice(0, courts);
  const counts = COURT_COUNTS.includes(courts) ? COURT_COUNTS : [...COURT_COUNTS, courts];
  const emit = (next: string[]) => {
    // Plain 1, 2, 3… needs no names: players just see Court 1, 2, 3.
    const plain = next.every((l, i) => l === String(i + 1));
    onChange(plain ? "" : next.join(", "), next.length);
  };
  const setCount = (n: number) => emit(fitCourtLabels(numbers.length ? numbers : ["1"], n));
  const setNumber = (i: number, label: string) => {
    const next = [...numbers];
    const taken = next.indexOf(label);
    if (taken >= 0) next[taken] = next[i]; // another court had it: they swap
    next[i] = label;
    emit(next);
  };
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">Courts</span>
        <select aria-label="Courts" className={cls(selectCls, "w-20 text-center")} value={courts} onChange={(e) => setCount(Number(e.target.value))}>
          {counts.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted">Court numbers</span>
        {numbers.map((label, i) => (
          <select
            key={i}
            aria-label={`Court number ${i + 1}`}
            className={selectCls}
            value={label}
            onChange={(e) => setNumber(i, e.target.value)}
          >
            {[...NUMBERS, ...(NUMBERS.includes(label) ? [] : [label])].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ))}
      </div>
    </div>
  );
}
