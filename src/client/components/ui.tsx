import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "subtle";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-royal text-white hover:bg-royal-dark active:bg-royal-dark font-bold shadow-[0_6px_18px_-8px_rgba(47,91,255,0.7)]",
  secondary: "bg-royal-soft text-royal hover:bg-royal-soft-2 font-bold",
  outline: "border-2 border-royal text-royal hover:bg-royal-soft font-bold",
  ghost: "bg-line/70 text-ink hover:bg-line font-semibold",
  danger: "bg-rose-soft text-rose-dark hover:bg-rose-100 font-semibold",
  subtle: "text-muted hover:bg-line/70 hover:text-ink font-semibold",
};

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
}) {
  const sizes = {
    sm: "px-3.5 py-1.5 text-sm rounded-full",
    md: "px-5 py-2.5 text-sm rounded-full",
    lg: "px-6 py-3.5 text-base rounded-full",
  };
  return (
    <button
      className={cls(
        "inline-flex items-center justify-center gap-2 transition-colors select-none",
        "disabled:opacity-40 disabled:pointer-events-none",
        buttonStyles[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || busy}
      {...rest}
    >
      {busy && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cls("rounded-3xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,29,53,0.04)]", className)}>
      {children}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cls(
        "w-full rounded-2xl border border-line-strong bg-white px-3.5 py-2.5 text-sm text-ink",
        "placeholder:text-faint outline-none focus:border-royal focus:ring-4 focus:ring-royal/15",
        "disabled:bg-canvas disabled:text-muted",
        className,
      )}
      {...rest}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

type BadgeTone = "lime" | "zinc" | "amber" | "sky" | "rose" | "emerald";

const badgeTones: Record<BadgeTone, string> = {
  lime: "bg-lime text-navy",
  zinc: "bg-line text-muted",
  amber: "bg-amber-soft text-amber-dark",
  sky: "bg-royal-soft text-royal",
  rose: "bg-rose-soft text-rose-dark",
  emerald: "bg-mint-soft text-mint-dark",
};

export function Badge({ tone = "zinc", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cls("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cls("animate-spin", className ?? "size-5")} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function PageSpinner() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center text-royal">
      <Spinner className="size-8" />
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-2xl bg-rose-soft px-4 py-3 text-sm font-medium text-rose-dark">{message}</div>;
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-line-strong bg-white/60 px-6 py-10 text-center">
      <p className="font-bold text-navy">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {children && <div className="mt-4 flex justify-center">{children}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/50 p-3 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-navy">{title}</h3>
          <button className="rounded-full p-1.5 text-muted hover:bg-line hover:text-navy" onClick={onClose} aria-label="Close">
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  big = false,
  step = 1,
  label,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  big?: boolean;
  step?: number;
  /** Names the buttons for screen readers and tests ("Increase players"). */
  label?: string;
  unit?: string;
}) {
  const btn = cls(
    "flex items-center justify-center rounded-full bg-royal-soft text-royal hover:bg-royal-soft-2 active:bg-royal-soft-2 disabled:opacity-30 font-black select-none",
    big ? "size-12 text-2xl" : "size-9 text-lg",
  );
  return (
    <div className="inline-flex items-center gap-3">
      <button
        type="button"
        className={btn}
        aria-label={label ? `Decrease ${label}` : undefined}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        −
      </button>
      <span className={cls("tabular text-center font-black text-navy", big ? "w-14 text-4xl" : "min-w-10 text-xl")}>
        {value}
        {unit && <span className="ml-0.5 text-xs font-bold text-muted">{unit}</span>}
      </span>
      <button
        type="button"
        className={btn}
        aria-label={label ? `Increase ${label}` : undefined}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        +
      </button>
    </div>
  );
}

export function CopyButton({ text, label = "Copy link", variant = "outline" }: { text: string; label?: string; variant?: ButtonVariant }) {
  return (
    <Button
      variant={variant}
      size="sm"
      onClick={async (e) => {
        const el = e.currentTarget;
        try {
          await navigator.clipboard.writeText(text);
          const prev = el.textContent;
          el.textContent = "Copied ✓";
          setTimeout(() => {
            el.textContent = prev;
          }, 1500);
        } catch {
          window.prompt("Copy this link:", text);
        }
      }}
    >
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Playtomic-style building blocks

/** Initials in a navy circle — no photos needed. */
export function Avatar({ name, size = "md", className, ring = false }: { name: string; size?: "sm" | "md" | "lg"; className?: string; ring?: boolean }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0]?.slice(0, 2) ?? "?");
  const sizes = { sm: "size-8 text-[11px]", md: "size-11 text-sm", lg: "size-14 text-base" };
  return (
    <span
      className={cls(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-navy font-bold uppercase tracking-wider text-white",
        ring && "ring-2 ring-lime ring-offset-2 ring-offset-white",
        sizes[size],
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cls("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}>
      <div className="h-full rounded-full bg-royal transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2 text-[15px] text-ink">
      <span className="flex size-7 shrink-0 items-center justify-center text-lg">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function StatCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="text-center">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-black text-navy">{value}</p>
    </div>
  );
}

export function SectionHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-lg font-black text-navy">{title}</h3>
      {action}
    </div>
  );
}

export function IconButton({ label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-10 items-center justify-center rounded-full bg-white text-navy shadow-md ring-1 ring-line hover:bg-canvas disabled:opacity-40"
      {...rest}
    >
      {children}
    </button>
  );
}
