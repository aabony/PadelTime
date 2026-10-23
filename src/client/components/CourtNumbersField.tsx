import { parseCourtLabels } from "../../shared/courts";
import { Field, Input } from "./ui";

/**
 * Which courts are booked, e.g. "3, 4": players then see Court 3 / Court 4
 * instead of Court 1 / Court 2. Typing names sets the number of courts.
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
  return (
    <Field label="Court numbers" hint="The courts you've booked, e.g. 3, 4 — players see these instead of Court 1, 2.">
      <Input
        value={value}
        placeholder={Array.from({ length: courts }, (_, i) => i + 1).join(", ")}
        onChange={(e) => onChange(e.target.value, parseCourtLabels(e.target.value).length || courts)}
      />
    </Field>
  );
}
