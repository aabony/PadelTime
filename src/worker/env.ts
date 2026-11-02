export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BETTER_AUTH_SECRET?: string;
  /** Resend API key for sending sign-in codes. Absent locally → codes are logged. */
  RESEND_API_KEY?: string;
  /** From address for sign-in codes, e.g. "PadelTime <login@example.com>". */
  MAIL_FROM?: string;
  /** "1" only in local dev (.dev.vars): enables GET /api/dev/otp for tests. */
  DEV_MODE?: string;
  /**
   * Who may run tournaments: comma-separated emails, or "*@domain" for a whole
   * domain. Matched case-insensitively on sign-in; anyone else is a player.
   */
  ADMIN_EMAILS?: string;
}
