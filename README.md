# 🎾 PadelTime

Run padel nights that run themselves — signups, check-in, Americano pairings, byes, live scoring and standings. Built entirely on Cloudflare.

## Architecture

Everything runs in a **single Cloudflare Worker**:

| Layer | Tech |
| --- | --- |
| Runtime | Cloudflare Workers (TypeScript) |
| API | [Hono](https://hono.dev) under `/api/*` |
| Database | Cloudflare **D1** (SQLite at the edge) via Drizzle ORM |
| Auth | [Better Auth](https://better-auth.com) — passwordless email OTP (6-digit sign-in codes via [Resend](https://resend.com); 90-day sessions in D1). Players register a profile (name, phone, DOB, gender, level, optional Playtomic level); admins listed in `ADMIN_EMAILS` run tournaments — see `docs/registration-and-sign-in.md` |
| Frontend | React 19 + Vite + Tailwind v4, served as [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) with SPA fallback |
| "Real-time" | 4-second visibility-aware polling (upgrade path: Durable Objects + WebSockets) |

> **Why D1 and not Postgres?** Cloudflare doesn't offer managed Postgres — D1 is its native database and is effectively zero-latency from a Worker. If real Postgres is ever needed, Cloudflare **Hyperdrive** connects Workers to external Postgres (Neon/Supabase/RDS), and the Drizzle data layer makes that a contained swap.

### Domain model (see `docs/` plan)

```
GROUP ──< GAME_SESSION ──< ROUND ──< MATCH ──< PLAYER_RESULTS
             │
             └──< SESSION_PLAYERS (users or guests; confirmed / waitlist / checked-in)
```

- **Format engine** (`src/shared/formats/`): one session engine, pluggable format strategies. Americano ships first; Mexicano / King of the Court drop in by implementing `FormatStrategy.planRound()`.
- **Americano scheduler**: scored stochastic search — repeat partners cost quadratically more than repeat opponents; byes rotate to whoever has sat least (then longest-ago).
- **Session lifecycle**: `draft → open → checkin → active → complete` (plus `cancelled`), enforced server-side.
- **Score integrity**: player submits → opposing team confirms → locked. Organizers have direct authority; every change lands in `score_audit`.
- **Player results** are denormalised per player per match (`player_results`) for future stats/ratings.

### Views

- **Player** (`/app/sessions/:id`): join → check in → "You're on Court 2 with George" → enter/confirm score → standings.
- **Organizer** (same page, more controls): roster & check-in, start round, force/redo/undo rounds, edit any score, warnings (repeat partners, bye imbalance, missing scores).
- **Beginner court** (session toggle): court 1 is reserved for the players the organizer tags as newbies. They rotate among themselves Americano-style with their own table; everyone else plays the session's format on the remaining courts and never shares a court with them. "Move up" / "move down" is the organizer's tap (the app only nudges: 3 straight wins on the beginner court, 0 wins after 3 ladder games). Short of four newbies, the bottom of the ladder plays down. **Competitive sit-outs** (second toggle): once everyone in a pool has 3 games, the lowest averages sit instead of the fair rotation.
- **Public join page** (`/join/:code`): the link you drop in WhatsApp.
- **Board / TV mode** (`/board/:code`): read-only auto-refreshing display for a courtside iPad/TV.

## Development

```bash
npm install
cp .dev.vars.example .dev.vars       # set BETTER_AUTH_SECRET
npm run db:migrate:local             # apply migrations to local D1
npm run dev                          # build web + wrangler dev on :8787
npm test                             # engine unit tests
npm run check                        # typecheck client + worker
```

## Deployment

The Worker is `padeltime`; the D1 database `padeltime-db` already exists (id in `wrangler.jsonc`).

```bash
npm run db:migrate:remote                          # apply schema to production D1
npx wrangler secret put BETTER_AUTH_SECRET         # openssl rand -base64 32
npx wrangler secret put RESEND_API_KEY             # sends the sign-in codes
npm run deploy                                     # vite build && wrangler deploy
```

Sign-in codes are sent from `MAIL_FROM` (wrangler.jsonc). Until your own domain is verified in Resend, the `onboarding@resend.dev` sender only delivers to the Resend account owner's email — verify the domain in Resend (DNS records on Cloudflare), then set `MAIL_FROM` to e.g. `PadelTime <login@andrewabony.com>`.

Deploys to `padeltime.<account>.workers.dev`. To attach a real domain later: Workers → padeltime → Settings → **Domains & Routes** → add custom domain (auth callbacks follow the request origin automatically, so no config change is needed).

## Roadmap (from the architecture plan)

- **V2**: Mexicano & King of the Court strategies, player ratings/seeding, recurring sessions, notifications (waitlist promotions, round ready), richer TV mode, historical group stats.
- **V3**: clubs, payments, leagues, public games, court booking integrations.
