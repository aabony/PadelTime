import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth";
import { Button } from "../components/ui";
import { Logo } from "../App";

const steps = [
  { icon: "📝", title: "Create a session", text: "Name, time, courts, points. Twenty seconds." },
  { icon: "🔗", title: "Share one link", text: "Players sign up from WhatsApp. Waitlist and check-in handled." },
  { icon: "🎾", title: "Play", text: "Americano pairings, byes and a live leaderboard — every round, automatically." },
];

function PaperSheetForm() {
  const [form, setForm] = useState({ players: 12, courts: 3, rounds: 6, points: 24 });
  const navigate = useNavigate();
  const field = (label: string, key: keyof typeof form, min: number, max: number) => (
    <label className="block text-center">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <input
        type="number"
        className="w-16 rounded-xl border border-line-strong bg-white px-2 py-1.5 text-center text-sm text-ink outline-none focus:border-royal"
        min={min}
        max={max}
        value={form[key]}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          setForm({ ...form, [key]: Number.isFinite(n) ? Math.min(Math.max(n, min), max) : form[key] });
        }}
      />
    </label>
  );
  return (
    <div className="flex flex-wrap items-end gap-3">
      {field("Players", "players", 4, 16)}
      {field("Courts", "courts", 1, 4)}
      {field("Rounds", "rounds", 3, 8)}
      {field("Points", "points", 4, 99)}
      <Button
        variant="secondary"
        onClick={() => navigate(`/print?players=${form.players}&courts=${form.courts}&rounds=${form.rounds}&points=${form.points}`)}
      >
        Generate sheet →
      </Button>
    </div>
  );
}

export function Landing() {
  const { data: session, isPending } = authClient.useSession();
  if (!isPending && session) return <Navigate to="/app" replace />;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-5">
        <Logo to="/" />
        <Link to="/login" className="text-sm font-bold text-royal hover:text-royal-dark">
          Sign in
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-5 pb-16">
        <div className="max-w-xl">
          <p className="mb-4 inline-block rounded-full bg-lime px-3 py-1 text-xs font-bold text-navy">
            Americano &amp; Mexicano · mixed pairs · live scores
          </p>
          <h1 className="text-4xl font-black leading-tight tracking-tight text-navy sm:text-6xl">
            Padel nights that
            <span className="text-royal"> run themselves.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted">
            Signups, check-in, rotating pairings, byes, scoring and a live leaderboard — so the only thing you
            organize is showing up.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/register">
              <Button size="lg">Start a session — it's free</Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="outline">
                Sign in
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.title} className="rounded-3xl border border-line bg-white p-5">
              <span className="mb-3 inline-flex size-9 items-center justify-center rounded-full bg-royal-soft text-lg">{s.icon}</span>
              <h3 className="font-black text-navy">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-3xl border border-line bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-sm">
              <h3 className="text-xl font-black text-navy">How many players, how many points? 🧮</h3>
              <p className="mt-1 text-sm text-muted">
                Dial in players, courts, 12-, 16- or 24-point games and court time, and see the on-court / off-court
                split for every player — measured on real nights, no account needed.
              </p>
            </div>
            <Link to="/plan">
              <Button size="lg" variant="secondary">
                Open the night planner
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-4 rounded-3xl border border-line bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-sm">
              <h3 className="text-xl font-black text-navy">Prefer pen &amp; paper? 📝</h3>
              <p className="mt-1 text-sm text-muted">
                Print a one-page Americano score sheet — pairings, byes and tally grid pre-generated by player number.
                Write the names in, play. No account needed.
              </p>
            </div>
            <PaperSheetForm />
          </div>
        </div>
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-faint">
        PadelTime — the organizer gets the complexity, the players get simplicity.
      </footer>
    </div>
  );
}
