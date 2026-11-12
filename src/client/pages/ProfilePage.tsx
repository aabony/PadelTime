import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/auth";
import { Api, useLoad } from "../lib/api";
import { Button, Card, ErrorNote, Field, FieldGroup, Input, PageSpinner } from "../components/ui";
import { GenderToggle } from "../components/GenderSelect";
import { PhoneField } from "../components/PhoneField";
import { LevelToggle } from "../components/LevelSelect";
import { Logo } from "../App";
import { PLAYTOMIC_MAX, PLAYTOMIC_MIN, namesFromLegacy, validateProfile } from "../../shared/profile";
import type { Gender } from "../../shared/genders";
import type { UserInfo } from "../../shared/types";

// The player profile — asked once, right after the first sign-in code, and
// editable any time from the header. `?next=` says where to go once it's saved
// (the join page that sent us here, or the home screen).

/** Only ever land on our own paths. */
export function safeNext(raw: string | null, fallback: string): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

export function ProfilePage() {
  const { data: session, isPending } = authClient.useSession();
  const [params] = useSearchParams();
  const next = params.get("next");
  if (isPending) return <PageSpinner />;
  if (!session) {
    const here = `/profile${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
  }
  return <ProfileScreen next={next} />;
}

function ProfileScreen({ next }: { next: string | null }) {
  const { data, error, loading } = useLoad(() => Api.me(), []);
  if (loading) return <PageSpinner />;
  if (error || !data) return <ErrorNote message={error ?? "Couldn't load your profile"} />;
  return (
    <div className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo to={data.user.profileComplete ? "/app" : "/"} />
        </div>
        <ProfileForm user={data.user} next={next} />
      </div>
    </div>
  );
}

export function ProfileForm({ user, next }: { user: UserInfo; next: string | null }) {
  const firstTime = !user.profileComplete;
  // An account from before this form has a display name only: start from it rather than a blank.
  const known = namesFromLegacy(user.name, user.email);
  const [form, setForm] = useState({
    firstName: user.firstName ?? known.firstName,
    lastName: user.lastName ?? known.lastName,
    phone: user.phone ?? "",
    dob: user.dob ?? "",
    gender: user.gender as Gender | null,
    level: user.level,
    playtomicLevel: user.playtomicLevel == null ? "" : String(user.playtomicLevel),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Same rules as the server, so the message arrives without a round trip.
    const check = validateProfile(form);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    try {
      const res = await Api.saveProfile(form);
      // Better Auth caches the user in the cookie for a few minutes; refresh
      // it so the header shows the new name straight away.
      await authClient.updateUser({ name: res.user.name });
      if (firstTime || next) {
        // A full page load so the app boots with the fresh session + profile.
        window.location.replace(safeNext(next, "/app"));
        return;
      }
      setSaved(true);
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setError(null); // the message was about the previous attempt
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <Card>
      <h1 className="mb-1 text-xl font-black text-navy">{firstTime ? "Finish signing up" : "Your profile"}</h1>
      <p className="mb-5 text-sm text-muted">
        {firstTime
          ? "A few details so the organizer can put you on the right court. You only do this once."
          : "What the organizer sees when you join a tournament. Your level feeds the draw."}
      </p>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Andrew" autoComplete="given-name" required autoFocus={firstTime} />
          </Field>
          <Field label="Last name">
            <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Abony" autoComplete="family-name" required />
          </Field>
        </div>
        <Field label="Email">
          <Input value={user.email} readOnly className="bg-canvas text-muted" />
        </Field>
        <FieldGroup label="Phone" hint="So the organizer can reach you on the night.">
          <PhoneField value={form.phone} onChange={(phone) => set("phone", phone)} autoComplete="tel-national" required />
        </FieldGroup>
        <Field label="Date of birth">
          <Input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} autoComplete="bday" required max={new Date().toISOString().slice(0, 10)} />
        </Field>
        <FieldGroup label="You are" hint="Needed for mixed-pairs nights (one woman + one man per team).">
          <GenderToggle value={form.gender} onChange={(gender) => set("gender", gender)} />
        </FieldGroup>
        <FieldGroup
          label="Your level"
          hint="Pick the one that sounds most like you. Only you and the organizer see it, and you can change it later."
        >
          <LevelToggle value={form.level} onChange={(level) => set("level", level)} />
        </FieldGroup>
        <Field label="Playtomic level (optional)" hint={`The number on your Playtomic profile, ${PLAYTOMIC_MIN} to ${PLAYTOMIC_MAX}.`}>
          <Input
            type="number"
            inputMode="decimal"
            step="0.1"
            min={PLAYTOMIC_MIN}
            max={PLAYTOMIC_MAX}
            value={form.playtomicLevel}
            onChange={(e) => set("playtomicLevel", e.target.value)}
            placeholder="e.g. 3.5"
          />
        </Field>
        <ErrorNote message={error} />
        <Button className="w-full" size="lg" busy={busy} type="submit">
          {firstTime ? "Let's play" : saved ? "Saved ✓" : "Save changes"}
        </Button>
        {!firstTime && (
          <p className="text-center text-sm">
            <Link to={safeNext(next, "/app")} className="font-semibold text-muted hover:text-royal">
              ← Back
            </Link>
          </p>
        )}
      </form>
    </Card>
  );
}
