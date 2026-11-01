# Registration, sign-in and admin access

Status: proposal, November 2026. Part 1 describes what the app does today. Part 2 describes where we want it to go. Part 3 is the build plan and the decisions still open.

Vocabulary: the code calls a padel night a **session** and a recurring group a **crew**. Andrew calls a session a **tournament**. This doc uses *session* when talking about the code and *tournament* when talking about the product.

---

## Part 1. How it works today

### 1.1 How people register

There is one account type and one way in. Anyone who lands on the site can create an account, and every account can run tournaments.

The flow, in order:

1. Landing page (`/`) shows two buttons: **"Start a session — it's free"** (goes to `/register`) and **"Sign in"** (goes to `/login`). Both pages are the *same screen*; only the heading differs.
2. The person types their **email**. The app emails them a **6-digit code**. No passwords exist anywhere.
3. They type the code. If the email has never been seen, an account is created on the spot. If it has, they are signed in.
4. First-timers are asked for **one thing: their name**. That is the whole profile.
5. They land on `/app`, the home screen, with a big **"+ New session"** button.

What is stored about a person: `name`, `email`, and a verified-email flag. Nothing else. No phone, no level, no gender.

Technical facts worth knowing:

| Thing | Current value | Where |
| --- | --- | --- |
| Auth library | Better Auth 1.3, email-OTP plugin | `src/worker/auth.ts` |
| Code length / lifetime | 6 digits, valid 10 minutes, 5 wrong attempts allowed | `src/worker/auth.ts` |
| Resend cooldown in the UI | 30 seconds | `src/client/pages/AuthPage.tsx` |
| Email sender | Resend, from `login@padeltime.andrewabony.com` | `wrangler.jsonc`, `src/worker/lib/email.ts` |
| Account tables | `user`, `session`, `account`, `verification` in D1 | `migrations/0001_init.sql` |
| Local testing | `DEV_MODE=1` exposes the last code at `/api/dev/otp` so the smoke test can sign in without an inbox. Never set in production. | `src/worker/routes/publicRoutes.ts` |

### 1.2 Starting a session (running a tournament)

Any signed-in account can do this. On first use the server silently creates a personal crew named "Andrew's sessions" and makes that person its organizer. Every session they create lands in that crew.

Who can manage a session is decided per request on the server: the person who created it, or any organizer of its crew. Everyone else who is a member of the crew or a player in the session can *view* it. There is no concept of a platform-wide admin in the code. The word "admin" appears only in the original architecture plan, which describes an admin as someone who controls how the platform works, distinct from an organizer who controls one night.

Crews (groups) have roles, `organizer` and `member`, and the server has endpoints to change roles and remove members, but **no screen in the app uses them**. In practice every account is its own organizer and crews are invisible.

### 1.3 How players join a tournament today

The organizer shares a link like `/join/ABCD2345` on WhatsApp. The join page is public and shows the night's details. To actually join:

1. Tap **"Continue with email →"**, which goes to the same code screen, then returns to the join page.
2. Tap **Join** (or **Join waitlist** when full, or **"Join — deal me in"** if the game is already on).

Level and gender are collected **on the join page, per session**, not on the account. The server remembers the last value a person gave so the toggles are pre-set next time. The organizer can also pre-add people as **guests** by name, and when a person later signs in with a matching name the guest entry becomes theirs.

Joining a session also quietly makes the person a member of that session's crew, so the session shows up on their home screen.

### 1.4 Signed-in sessions (staying logged in)

Better Auth stores a login session in D1 and sets a cookie. We use its defaults: a login lasts **7 days** and is extended whenever the person is active, with a 5-minute cache so most page loads do not hit the database. Signing out is a button in the header. There is no "remember me", no device list, and no way to sign out everywhere.

### 1.5 What is missing for the new goal

- The account holds no **phone number, gender, level or Playtomic rating**. Level and gender live on each session's roster, so they are re-asked and can drift.
- A player and an organizer are the **same thing**. The landing page sells "start a session" to everyone, so a player who just wants to sign up to Sunday ends up on a screen whose main button creates tournaments.
- Players have **no home of their own**: no profile page, no list of upcoming tournaments to sign up for, no way to edit their details.
- There is **no admin role**, so there is nothing to gate the organizer tools behind.
- The organizer's roster shows names, level and gender but not phone or Playtomic rating, so there is no way to contact people or sanity-check a self-rating.

---

## Part 2. Where we want to go

### 2.1 Two front doors

**Players** are the audience. The landing page becomes a player page: upcoming tournaments to sign up for, a **Register** button, and a **Sign in** link for returning players.

**Admin** (Andrew, and anyone he names later) gets a small **"Admin sign in"** link in the footer. It uses the same email-code flow but only admin accounts get through to the organizer tools. There is one admin today, so this needs to be safe and simple, not elaborate.

### 2.2 The player profile

Registration collects everything once, on the account, so a player answers these questions one time and every tournament reads from the profile.

| Field | Required | Notes |
| --- | --- | --- |
| First name | Yes | Shown on court and in standings as "First L." when two people share a first name |
| Last name | Yes | |
| Phone | Yes | For the organizer to reach people. Stored as entered plus a normalised international form. Not used for login in v1 (see open question 1) |
| Email | Yes | The login identity. Verified by the 6-digit code |
| Gender | Yes | woman / man, same two values the mixed-pairs draw already uses |
| Playing level | Yes | The three buckets the engine already understands: beginner / intermediate / advanced |
| Playtomic level | Optional | A number from 0.5 to 7 with one decimal, the scale Playtomic shows on a profile. Lets the admin sanity-check the self-rated bucket and seed groups more finely later |
| Playtomic profile link | Optional | Cheap to store, lets the admin click through to verify. Recommend keeping it optional and low on the form; drop it if it hurts completion |

The existing per-session level and gender stay on the roster row, but they are **copied from the profile** when a player joins, and the organizer can still override a level for one night. A player editing their profile does not rewrite nights already played.

### 2.3 How registration works

Two entry points, one form.

**From a tournament link** (the WhatsApp case, the most common):

1. Open `/join/ABCD2345`. See the night's details and the roster count, as today.
2. Tap **Register and join**. New players see the profile form (section 2.2) with email at the top. Returning players see only the email box.
3. Code arrives by email, player types it. New accounts are created with the full profile in one step. The player is now **joined to that tournament** and lands back on the join page showing "You're in".

**From the landing page** (no link):

1. Tap **Register**. Same form, same code.
2. Land on the **player home**: upcoming tournaments open for signup, each with a Join button, plus "Your tournaments" and a profile link.

Rules carried over from today: a full tournament puts you on the waitlist, joining while the game is on deals you in from the next round, and a guest the admin pre-added by name is claimed automatically when the names match.

### 2.4 Sign-in for returning players

Email, code, done. Profile fields are never re-asked. Two changes make this nearly invisible for regulars:

- **Stay signed in for 90 days** instead of 7. This is a phone-first app used weekly; a regular should not see the code screen more than a few times a year. Signing out still works.
- **The join link remembers you.** If a signed-in player opens a link, the page shows one button: Join. No code screen at all.

A player who moves phones or clears the browser just does email and code again.

### 2.5 The player home (`/app` for players)

- **Open for signup**: tournaments the admin has opened, with date, venue, spots left and a Join / Leave button. Signed-up ones show "You're in" or "Waitlist".
- **Your tournaments**: what you have joined, with the live view when a night is on, and results when it is over.
- **Profile**: edit any field from 2.2. Level changes take effect for tournaments not yet started.

This is the screen that answers "can people sign in to tournaments before they get there". Yes, from the link or from the home page, and the admin sees the roster fill up with levels attached.

### 2.6 Admin

- **Who is admin**: a list of email addresses in the Worker's configuration, starting with Andrew's. On sign-in the server marks the account as admin if its email is on the list. No admin screens for managing admins in v1; editing the list and redeploying is fine for one or two people. If that gets annoying, step two is an `is_admin` column that an existing admin can flip from a screen.
- **How to get in**: footer link **"Admin sign in"** on the landing page goes to `/admin`. Same email-code screen. A non-admin who signs in there is told "This account can't run tournaments" and sent to the player home.
- **What admin unlocks**: everything organizers can do today. The "New session" button, roster management, start round, scores, the session controls. All of it is already gated server-side by the organizer check; the change is that the check also requires admin. The crew (group) layer stays in the database untouched but remains hidden.
- **Admin roster view** gains the new fields: phone, gender, self-rated level, Playtomic level and link, so the admin can group people before the night and call anyone who is late. Plus a **Copy roster** / export action for the WhatsApp group.
- **Admin is also a player.** Andrew's account joins tournaments like anyone else. The admin flag only adds controls, it does not remove the player view.

### 2.7 What does not change

Email-code login, Resend, Cloudflare Workers and D1, Better Auth, the join-code links, the guest flow, the engine, scoring and standings. This is a re-organisation of who sees what and what we know about each person, not a rebuild.

---

## Part 3. Build plan and open decisions

### 3.1 Phases

**Phase 1. Profile and admin gate.** The minimum that makes the new model real.

- Add profile columns to the `user` table: `first_name`, `last_name`, `phone`, `phone_e164`, `gender`, `level`, `playtomic_level`, `playtomic_url`, `is_admin`. Keep `name` as "First Last" so nothing that reads `name` today breaks.
- Registration form (2.2) replacing today's name-only step. Existing accounts with a name but no profile are asked to complete it on their next visit.
- Admin email list in configuration; set `is_admin` on sign-in. Gate session creation and organizer actions on it, server-side and in the UI.
- Landing page: player copy, Register and Sign in buttons, **Admin sign in** in the footer, `/admin` route.
- Join flow copies level and gender from the profile.
- Login lifetime to 90 days.

**Phase 2. Player home and admin roster.**

- Player home with "Open for signup", "Your tournaments" and Profile.
- A per-tournament **public listing** flag so the admin decides which nights appear on the home page versus link-only.
- Admin roster shows phone, Playtomic level and link; copy / export roster.
- Standings disambiguate shared first names with last initial.

**Phase 3. Reach.**

- WhatsApp or SMS as an alternative to email for the code, now that phone is on file.
- Waitlist-promoted and "game starts soon" messages, which the architecture plan already calls for.
- Optional: sort or seed by Playtomic level inside the "group by level" option.

### 3.2 Decisions to confirm

Each has a recommended default so Phase 1 can start without waiting.

1. **Login identity: email or phone?** Recommend **email** for v1. It is built, verified and free. Phone is collected as a contact field. Moving the code to SMS or WhatsApp later is a Phase 3 add-on, not a change of identity.
2. **Playtomic link: keep or drop?** Recommend **keep, optional, at the bottom of the form**. Zero cost, useful for a sanity check. Drop it if registration completion suffers.
3. **Playtomic level scale.** Recommend a **single decimal from 0.5 to 7.0**, matching what Playtomic displays. Shown to the admin only.
4. **Which tournaments appear on the player home?** Recommend **admin opt-in per tournament**, default off, so private nights stay link-only.
5. **How long to stay signed in.** Recommend **90 days**.
6. **Required fields.** Recommend phone, gender and level all **required**. The whole point is organising people before they arrive, and optional fields stay empty.
7. **Existing players.** Recommend **ask on next visit**, blocking, one screen. There are few accounts and the fields are quick.
8. **Should admins be able to run tournaments for a named crew?** Recommend **no change**: the crew layer stays hidden. Revisit when there is a second organizer.

### 3.3 Files that change in Phase 1

- `src/worker/auth.ts`: profile fields on the user, 90-day sessions, admin flag from the email list.
- `src/worker/env.ts`, `wrangler.jsonc`: `ADMIN_EMAILS` variable.
- `migrations/0009_player_profiles.sql` and `src/worker/db/schema.ts`: the new columns.
- `src/worker/lib/ensureSchema.ts`: lazy-apply the migration in production as the others do.
- `src/worker/routes/groups.ts`, `sessions.ts`: admin check on create and organizer actions; profile in `/api/me`.
- `src/worker/routes/publicRoutes.ts`: join copies level and gender from the profile.
- `src/client/pages/AuthPage.tsx`: the registration form; `/admin` mode.
- `src/client/pages/Landing.tsx`, `Home.tsx`, `App.tsx`: player-first copy, footer admin link, hide "New session" for non-admins.
- `src/shared/types.ts`: profile fields on `UserInfo`, `isAdmin` on `MeResponse`.
- `test/e2e-smoke.mjs`: register with the full form; admin sign-in path.
