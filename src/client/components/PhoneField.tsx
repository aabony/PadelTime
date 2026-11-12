import { useState } from "react";
import { COUNTRIES, DEFAULT_COUNTRY_CODE, joinPhone, splitPhone } from "../../shared/phone";
import { cls } from "./ui";

const boxCls =
  "rounded-2xl border border-line-strong bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-royal focus:ring-4 focus:ring-royal/15";

/**
 * A phone number as a country code plus the number. It starts on the USA (+1),
 * where most players are, so they just type their 10 digits. `value` and
 * `onChange` speak the stored form ("+15129923681").
 *
 * Pasting or typing a full international number ("+34 600 123 456") into the
 * number box moves the country code over by itself. "Other" is for a country
 * that isn't listed: type the number with its code.
 */
export function PhoneField({
  value,
  onChange,
  required = false,
  autoComplete,
}: {
  value: string;
  onChange: (stored: string) => void;
  required?: boolean;
  autoComplete?: string;
}) {
  const start = splitPhone(value);
  // No number yet: the default country. A stored number keeps its own code ("" = one we don't list).
  const [code, setCode] = useState(value ? start.code : DEFAULT_COUNTRY_CODE);
  const [text, setText] = useState(value && !start.code ? `+${start.national}` : start.national);

  const emit = (nextCode: string, nextText: string) => onChange(joinPhone(nextCode, nextText));
  const typed = (v: string) => {
    if (v.trim().startsWith("+")) {
      // A full international number: let it choose the country.
      const split = splitPhone(v);
      if (split.code) {
        setCode(split.code);
        setText(split.national);
        emit(split.code, split.national);
        return;
      }
      setCode("");
      setText(v);
      emit("", v);
      return;
    }
    setText(v);
    emit(code, v);
  };
  const us = code === DEFAULT_COUNTRY_CODE;
  return (
    <div>
      <div className="flex gap-2">
        <select
          aria-label="Country code"
          className={cls(boxCls, "w-[6.5rem] shrink-0 px-2 font-semibold")}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            emit(e.target.value, text);
          }}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} +{c.code} {c.name}
            </option>
          ))}
          <option value="">🌐 Other</option>
        </select>
        <input
          aria-label="Phone"
          type="tel"
          inputMode="tel"
          className={cls(boxCls, "min-w-0 flex-1")}
          value={text}
          onChange={(e) => typed(e.target.value)}
          placeholder={us ? "512 555 0123" : code ? "Phone number" : "+ country code and number"}
          autoComplete={autoComplete}
          required={required}
        />
      </div>
      <span className="mt-1 block text-xs text-faint">
        {us ? "10 digits, area code first. Not in the USA? Change the country." : code ? "Your number without the country code." : "Type the whole number, starting with + and the country code."}
      </span>
    </div>
  );
}
