import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/auth";
import { Api } from "../lib/api";
import { Button, Card, ErrorNote, Field, Input } from "../components/ui";
import { Logo } from "../App";
import { safeNext } from "./ProfilePage";

// Passwordless sign-in: email → 6-digit emailed code. Accounts are created on
// the first code; a new player then fills in their profile (/profile) before
// landing where they were headed. /login, /register and /admin share this
// screen — "admin" additionally checks the account may run tournaments.

export type AuthMode = "login" | "register" | "admin";

const COPY: Record<AuthMode, { title: string; blurb: string; foot: string }> = {
  register: {
    title: "Register to play",
    blurb: "No passwords — we'll email you a 6-digit code. Then a few details so the organizer can place you.",
    foot: "Already registered? Use the same email — one code signs you in.",
  },
  login: {
    title: "Sign in",
    blurb: "No passwords here — we'll email you a 6-digit code. New emails get an account automatically.",
    foot: "One code signs you in and creates your account if you're new.",
  },
  admin: {
    title: "Admin sign in",
    blurb: "For whoever runs the tournaments. Same email code as everyone else; only admin accounts get the organizer tools.",
    foot: "Just here to play? Use Sign in instead.",
  },
};

export function AuthPage({ mode }: { mode: AuthMode }) {
  const [step, setStep] = useState<"email" | "code" | "notAdmin">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const verifying = useRef(false);
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"), "/app");
  const copy = COPY[mode];

  // A full page load after sign-in guarantees the app boots with a fresh
  // session read — an in-app navigate can race the cached "no session"
  // state and bounce straight back to login.
  const enter = (to = next) => window.location.replace(to);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const res = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim().toLowerCase(),
      type: "sign-in",
    });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Couldn't send the code — try again");
    } else {
      setStep("code");
      setCode("");
      setCooldown(30);
    }
  };

  const verify = async (otp: string) => {
    if (verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.emailOtp({ email: email.trim().toLowerCase(), otp });
    if (res.error) {
      setBusy(false);
      verifying.current = false;
      setError(res.error.message ?? "That code didn't work — try again");
      setCode("");
      return;
    }
    try {
      const me = await Api.me();
      if (mode === "admin" && !me.user.isAdmin) {
        setBusy(false);
        verifying.current = false;
        setStep("notAdmin");
        return;
      }
      if (!me.user.profileComplete) {
        enter(`/profile?next=${encodeURIComponent(next)}`);
        return;
      }
    } catch {
      // If the profile check itself fails, the home screen asks again.
    }
    enter();
  };

  // Auto-verify the moment 6 digits are in.
  useEffect(() => {
    if (step === "code" && /^\d{6}$/.test(code)) void verify(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo to="/" />
        </div>
        <Card>
          {step === "email" && (
            <>
              <h1 className="mb-1 text-xl font-black text-navy">{copy.title}</h1>
              <p className="mb-5 text-sm text-muted">{copy.blurb}</p>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendCode();
                }}
              >
                <Field label="Email">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    autoFocus
                  />
                </Field>
                <ErrorNote message={error} />
                <Button className="w-full" size="lg" busy={busy} type="submit">
                  Email me a code
                </Button>
              </form>
            </>
          )}

          {step === "code" && (
            <>
              <h1 className="mb-1 text-xl font-black text-navy">Check your inbox</h1>
              <p className="mb-5 text-sm text-muted">
                We sent a 6-digit code to <span className="font-bold text-navy">{email.trim()}</span>.
              </p>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (/^\d{6}$/.test(code)) void verify(code);
                }}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  className="text-center text-2xl font-black tracking-[0.5em] text-navy"
                  autoFocus
                />
                <ErrorNote message={error} />
                <Button className="w-full" size="lg" busy={busy} type="submit" disabled={code.length !== 6}>
                  {mode === "register" ? "Continue" : "Sign in"}
                </Button>
              </form>
              <div className="mt-4 flex items-center justify-between text-sm">
                <button className="font-semibold text-muted hover:text-royal" onClick={() => { setStep("email"); setError(null); }}>
                  ← Different email
                </button>
                <button
                  className="font-semibold text-royal hover:text-royal-dark disabled:opacity-40"
                  disabled={cooldown > 0 || busy}
                  onClick={() => void sendCode()}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </>
          )}

          {step === "notAdmin" && (
            <>
              <h1 className="mb-1 text-xl font-black text-navy">This account can't run tournaments</h1>
              <p className="mb-5 text-sm text-muted">
                You're signed in as <span className="font-bold text-navy">{email.trim()}</span>, but that email isn't on
                the admin list. You can still join tournaments as a player.
              </p>
              <Button className="w-full" size="lg" onClick={() => enter("/app")}>
                Go to my tournaments
              </Button>
            </>
          )}
        </Card>
        {step === "email" && (
          <p className="mt-4 text-center text-xs text-faint">
            {copy.foot}
            {mode === "admin" && (
              <>
                {" "}
                <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-royal">
                  Sign in
                </Link>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
