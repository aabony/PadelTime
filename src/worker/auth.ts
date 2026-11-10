import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { Env } from "./env";
import { sendOtpEmail } from "./lib/email";

// Passwordless auth: a 6-digit one-time code emailed on every sign-in.
// First-time emails auto-create an account; the client then collects the
// player profile (name, phone, DOB, gender, level — src/shared/profile.ts) via
// PUT /api/me/profile. OTPs live in the existing `verification` table.
// Who is an admin (may run tournaments) comes from ADMIN_EMAILS, see
// routes/index.ts.
//
// Instantiated per request: env bindings are request-scoped on Workers, and
// baseURL follows the request origin so workers.dev and the custom domain
// both work with zero config changes.
//
// `waitUntil` (the request's ExecutionContext) lets the sign-in code email go
// out after the response: "Email me a code" answers as soon as the code is
// stored instead of waiting on the mail provider, and the send survives the
// client disconnecting.
export function makeAuth(env: Env, origin: string, waitUntil?: (p: Promise<unknown>) => void) {
  const db = drizzle(env.DB, { schema });
  return betterAuth({
    baseURL: origin,
    advanced: waitUntil ? { backgroundTasks: { handler: waitUntil } } : undefined,
    secret: env.BETTER_AUTH_SECRET || "insecure-dev-secret-change-me",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600, // 10 minutes
        allowedAttempts: 5,
        async sendVerificationOTP({ email, otp }) {
          await sendOtpEmail(env, email, otp);
        },
      }),
    ],
    session: {
      // Phone-first, played weekly: regulars should rarely see the code screen.
      expiresIn: 60 * 60 * 24 * 90, // 90 days
      updateAge: 60 * 60 * 24, // extend once a day while active
      cookieCache: { enabled: true, maxAge: 300 },
    },
  });
}

export type Auth = ReturnType<typeof makeAuth>;
