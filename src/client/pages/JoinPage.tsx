import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { authClient } from "../lib/auth";
import { Api, useLoad } from "../lib/api";
import { fmtTimeRange } from "../lib/format";
import { Badge, Button, Card, ErrorNote, InfoRow, PageSpinner, ProgressBar, StatCell } from "../components/ui";
import { Logo } from "../App";
import { statusTone } from "./Home";
import { blurbFor, formatMeta } from "../../shared/formatMeta";
import { GenderToggle } from "../components/GenderSelect";
import { LevelToggle } from "../components/LevelSelect";
import { StandingsTable } from "../components/StandingsTable";
import type { Gender } from "../../shared/genders";

/** The night is over: the podium and the final table, for anyone with the link. */
function FinalResults({ code }: { code: string }) {
  const { data } = useLoad(() => Api.results(code), [code]);
  if (!data) return null;
  const table = (data.teamStandings ?? data.standings).filter((r) => r.played > 0);
  const podium = table.filter((r) => r.ranked).slice(0, 3);
  return (
    <Card className="mt-4">
      <h3 className="text-lg font-black text-navy">🏆 Final results</h3>
      {podium.length > 0 && (
        <p className="mb-2 mt-1 text-sm font-semibold text-ink">
          {podium.map((r, i) => `${["🥇", "🥈", "🥉"][i]} ${r.name} ${r.points}`).join("  ·  ")}
        </p>
      )}
      <StandingsTable standings={table} compact />
    </Card>
  );
}

export function JoinPage() {
  const { code = "" } = useParams();
  const { data: session, isPending } = authClient.useSession();
  const { data, error, loading, reload } = useLoad(() => Api.joinInfo(code), [code]);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // undefined = untouched → fall back to what the server remembers
  const [genderPick, setGenderPick] = useState<Gender | null | undefined>(undefined);
  const [levelPick, setLevelPick] = useState<number | null | undefined>(undefined);
  const navigate = useNavigate();

  if (loading || isPending) return <PageSpinner />;

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setJoinErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setJoinErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <Card className="text-center">
          <p className="text-ink">{error ?? "Invite not found"}</p>
        </Card>
      </div>
    );
  }

  const spotsLeft = Math.max(0, data.maxPlayers - data.confirmedCount);
  const joined = !!data.myStatus && data.myStatus !== "dropped";
  const over = ["complete", "cancelled"].includes(data.status);
  const live = data.status === "active";
  const paused = data.status === "checkin" && data.roundsPlayed > 0;
  // While the game is on (check-in or live) joining can check you in on the spot.
  const playing = data.status === "checkin" || live;
  const nextRound = data.roundsPlayed + 1;

  const stageLabel = live
    ? `Live · round ${data.roundsPlayed}`
    : paused
      ? `Paused after ${data.roundsPlayed} round${data.roundsPlayed === 1 ? "" : "s"}`
      : data.status === "checkin"
        ? "Checking in now"
        : data.status === "open"
          ? "Open for signup"
          : data.status === "draft"
            ? "Not open yet"
            : data.status === "complete"
              ? "Finished"
              : "Cancelled";

  const gender = genderPick === undefined ? data.myGender : genderPick;
  const level = levelPick === undefined ? data.myLevel : levelPick;
  const join = (here: boolean) => act(here ? "here" : "join", () => Api.join(code, { here, gender, level }));
  const pickLevel = (l: number | null) => {
    setLevelPick(l);
    if (joined) act("level", () => Api.setMyLevel(data.sessionId, l));
  };
  const pickGender = (g: Gender | null) => {
    setGenderPick(g);
    if (joined) act("gender", () => Api.setMyGender(data.sessionId, g));
  };
  const checkIn = () => act("here", () => Api.selfCheckin(data.sessionId));
  const openSession = () => navigate(`/app/sessions/${data.sessionId}`);

  return (
    <div className="min-h-dvh bg-canvas pb-32">
      <div className="mx-auto max-w-lg">
        <div className="court-banner relative h-40 sm:rounded-b-3xl">
          <div className="absolute left-4 top-4 inline-flex rounded-full bg-white px-3 py-1.5 shadow-md">
            <Logo to="/" />
          </div>
        </div>
        <div className="px-3">
          <Card className="relative -mt-14 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted">
                {over ? "Padel night" : "You're invited"}
              </p>
              <Badge tone={statusTone(data.status)}>{stageLabel}</Badge>
            </div>
            <h1 className="mt-1 text-2xl font-black leading-tight text-navy">{data.name}</h1>
            {data.startsAt != null && (
              <p className="mt-1 text-sm text-muted">{fmtTimeRange(data.startsAt, data.durationMin)}</p>
            )}
            {data.venue && <p className="text-sm text-muted">📍 {data.venue}</p>}
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
              <StatCell label="Format" value={formatMeta(data.format).name} />
              <StatCell label="Points" value={data.pointsPerMatch} />
              <StatCell label="Courts" value={data.courts} />
            </div>
          </Card>

          {data.status === "complete" && <FinalResults code={code} />}

          {playing && !joined && !over && (
            <Card className="mt-4 border-royal/30 bg-royal-soft/40">
              <p className="font-black text-navy">
                {live
                  ? "The game is already on — jump in."
                  : paused
                    ? "The game is paused between rounds."
                    : "Check-in is happening now."}
              </p>
              <p className="mt-1 text-sm text-ink">
                {live
                  ? `Round ${data.roundsPlayed} is on court. Join now and you're in the rotation from round ${nextRound} — the organizer sees you straight away.`
                  : `Join now and you're in the rotation from round ${nextRound}.`}
              </p>
            </Card>
          )}

          {!over && (
            <Card className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-navy">Players</h3>
                <span className="tabular text-sm font-bold text-navy">
                  {data.confirmedCount} <span className="font-medium text-muted">/ {data.maxPlayers}</span>
                </span>
              </div>
              <ProgressBar value={data.confirmedCount} max={data.maxPlayers} className="mt-3" />
              <p className="mt-2 text-xs text-muted">
                {spotsLeft > 0
                  ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`
                  : "Full — new joins go on the waitlist"}
                {data.waitlistCount > 0 && ` · ${data.waitlistCount} waitlisted`}
              </p>
            </Card>
          )}

          {!over && joined && data.fixedTeams && (
            <Card className="mt-4">
              <h3 className="text-lg font-black text-navy">🤝 Your partner</h3>
              <p className="text-sm text-muted">
                {data.myPartner ? (
                  <>
                    You play with <b className="text-navy">{data.myPartner}</b> all night.
                  </>
                ) : (
                  `Teams stay together all night. The organizer pairs you, or you're paired when the ${data.roundsPlayed > 0 ? "next" : "first"} round is dealt.`
                )}
              </p>
            </Card>
          )}

          {!over && data.mixedPairs && (
            <Card className="mt-4">
              <h3 className="text-lg font-black text-navy">You are…</h3>
              <p className="mb-3 text-xs text-muted">
                Mixed pairs night: every team is one woman + one man, so the draw needs to know.
              </p>
              <GenderToggle value={gender} busy={busy === "gender"} onChange={pickGender} />
            </Card>
          )}

          {!over && (
            <Card className="mt-4">
              <h3 className="text-lg font-black text-navy">Your level</h3>
              <p className="mb-3 text-xs text-muted">Only you and the organizer see it.</p>
              <LevelToggle value={level} busy={busy === "level"} onChange={pickLevel} />
            </Card>
          )}

          {!over && (
            <Card className="mt-4">
              <h3 className="mb-1 text-lg font-black text-navy">How it works</h3>
              <div className="divide-y divide-line">
                <InfoRow icon={formatMeta(data.format).emoji}>
                  <b>
                    {data.fixedTeams && "Team "}
                    {formatMeta(data.format).name}
                  </b>{" "}
                  — {blurbFor(data.format, { fixedTeams: data.fixedTeams })}
                </InfoRow>
                <InfoRow icon="🎯">
                  Games to {data.pointsPerMatch} points; every point you win counts for{" "}
                  {data.fixedTeams ? "your team" : "you"}.
                </InfoRow>
              </div>
            </Card>
          )}

          <div className="mt-4">
            <ErrorNote message={joinErr} />
          </div>
        </div>
      </div>

      {/* Sticky action, Playtomic-style (nothing to do on a finished night unless you played) */}
      {!(data.status === "complete" && !joined) && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-lg">
            {joined ? (
              data.myStatus === "waitlist" ? (
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-amber-dark">
                    You're on the waitlist — hang tight.
                  </p>
                  <Button size="lg" onClick={openSession}>
                    Open session
                  </Button>
                </div>
              ) : playing && data.myStatus === "confirmed" ? (
                <div>
                  <p className="mb-2 text-sm font-semibold text-navy">
                    You're in ✓ — check in when you're at the courts.
                  </p>
                  <div className="flex gap-2">
                    <Button className="flex-1" size="lg" busy={busy === "here"} onClick={checkIn}>
                      ✓ I'm here
                    </Button>
                    <Button variant="secondary" size="lg" onClick={openSession}>
                      Open session
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-navy">
                    {data.myStatus === "checked_in" && live
                      ? "You're in ✓ — in the rotation from the next round."
                      : "You're in ✓"}
                  </p>
                  <Button size="lg" onClick={openSession}>
                    Open session
                  </Button>
                </div>
              )
            ) : over ? (
              <Button className="w-full" size="lg" disabled>
                Session cancelled
              </Button>
            ) : data.status === "draft" ? (
              <Button className="w-full" size="lg" disabled>
                Signup hasn't opened yet
              </Button>
            ) : !session ? (
              <Link to={`/login?next=${encodeURIComponent(`/join/${code}`)}`} className="block">
                <Button className="w-full" size="lg">
                  Continue with email →
                </Button>
              </Link>
            ) : playing && spotsLeft > 0 ? (
              <Button className="w-full" size="lg" busy={busy === "here"} onClick={() => join(true)}>
                ✓ Join — deal me in
              </Button>
            ) : (
              <Button className="w-full" size="lg" busy={busy === "join"} onClick={() => join(false)}>
                {spotsLeft > 0 ? "Join session" : "Join waitlist"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
