import type { Env } from "../env";

/** How long one attempt may take before it's abandoned and retried. */
const ATTEMPT_TIMEOUT_MS = 8000;
/** A busy sign-up moment (everyone registering at once) can hit the provider's rate limit: retry rather than drop the code. */
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Transactional email via Resend's HTTPS API (no SMTP needed on Workers).
// Without an API key (local dev) the code is logged instead — pair with
// DEV_MODE=1 and GET /api/dev/otp for automated tests.
//
// Every attempt has a timeout, and rate limits (429), provider errors (5xx)
// and network failures are retried with a short backoff. Runs in the
// background (see makeAuth), so the person isn't kept waiting on any of this.
export async function sendOtpEmail(env: Env, email: string, otp: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[dev] sign-in code for ${email}: ${otp}`);
    return;
  }
  const from = env.MAIL_FROM || "PadelTime <onboarding@resend.dev>";
  const body = JSON.stringify({
    from,
    to: [email],
    subject: `${otp} is your PadelTime code`,
    text: `Your PadelTime sign-in code is ${otp}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px">
  <p style="font-size:18px;font-weight:800;margin:0 0 16px">🎾 Padel<span style="color:#84cc16">Time</span></p>
  <p style="font-size:14px;color:#3f3f46;margin:0 0 8px">Your sign-in code:</p>
  <p style="font-size:36px;font-weight:800;letter-spacing:8px;margin:0 0 16px">${otp}</p>
  <p style="font-size:12px;color:#71717a;margin:0">Expires in 10 minutes. If you didn't request this, ignore this email.</p>
</div>`,
  });

  let lastProblem = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let wait = 400 * attempt;
    try {
      const res = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (res.ok) return;
      lastProblem = `${res.status} ${await res.text().catch(() => "")}`;
      // Anything but a rate limit or a provider hiccup won't get better on a retry (bad address, bad key).
      if (res.status !== 429 && res.status < 500) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) wait = Math.min(retryAfter * 1000, 3000);
    } catch (e) {
      lastProblem = String((e as Error)?.message ?? e); // timeout or network failure
    }
    if (attempt < MAX_ATTEMPTS) await sleep(wait);
  }
  console.error("Resend send failed:", lastProblem);
  throw new Error("Could not send the sign-in code email");
}
