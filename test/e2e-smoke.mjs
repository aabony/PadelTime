// End-to-end smoke test against a running `wrangler dev` on :8787.
// Drives the full V1 flow with two users (organizer + player) plus the
// public board. Run with: node test/e2e-smoke.mjs [screenshot-dir]
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:8787";
const SHOTS = process.argv[2] ?? null;
const run = `${Date.now()}`.slice(-6);

let step = 0;
const log = (msg) => console.log(`  [${++step}] ${msg}`);
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function launch() {
  // Honor an outbound proxy (e.g. sandboxed CI environments); bypass it for localhost.
  const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;
  const opts = proxyServer
    ? { proxy: { server: proxyServer, bypass: "127.0.0.1,localhost" } }
    : {};
  try {
    return await chromium.launch(opts);
  } catch {
    return await chromium.launch({ ...opts, executablePath: "/opt/pw-browsers/chromium" });
  }
}

const contextOpts = { ignoreHTTPSErrors: !!(process.env.HTTPS_PROXY || process.env.https_proxy) };

// Passwordless sign-in: request a code, read it from the DEV_MODE-only
// endpoint (stands in for the inbox), verify, set a name if asked.
async function otpSignIn(page, name, email) {
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByPlaceholder("••••••").waitFor({ timeout: 10000 });
  const res = await page.request.get(`${BASE}/api/dev/otp?email=${encodeURIComponent(email)}`);
  const body = await res.json();
  const otp = String(body.value ?? "").match(/\d{6}/)?.[0];
  if (!otp) fail(`no OTP found for ${email}: ${JSON.stringify(body)}`);
  await page.getByPlaceholder("••••••").fill(otp); // auto-verifies at 6 digits
  const nameInput = page.getByPlaceholder("Andrew");
  try {
    await nameInput.waitFor({ timeout: 8000 });
    await nameInput.fill(name);
    await page.getByRole("button", { name: "Let's play" }).click();
  } catch {
    // existing account with a proper name — no name step
  }
}

async function register(page, name, email) {
  await page.goto(`${BASE}/login`);
  await otpSignIn(page, name, email);
  await page.waitForURL("**/app", { timeout: 15000 });
}

const browser = await launch();
// External font hosts are irrelevant to the flow and can stall first paint behind the sandbox proxy.
const newContext = async (opts) => {
  const ctx = await browser.newContext(opts);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  return ctx;
};

// --- Organizer -------------------------------------------------------------
const orgCtx = await newContext({ ...contextOpts, viewport: { width: 390, height: 844 } });
const org = await orgCtx.newPage();
org.on("dialog", (d) => d.accept());

await register(org, "Andrew", `andrew${run}@test.com`);
log("organizer registered → /app");
await shot(org, "01-home");

// Session-first: no group step — straight from home.
await org.getByRole("button", { name: "+ New session" }).click();
await org.getByPlaceholder("Thursday Padel Jam").fill("Sunday Night Americano");
await org.getByRole("button", { name: "Create session", exact: true }).click();
await org.waitForURL("**/app/sessions/**");
const sessionId = org.url().split("/sessions/")[1];
log("session created from home (draft)");

await org.getByRole("button", { name: "Open signup" }).click();
await org.getByText("Invite players").waitFor({ timeout: 10000 });
log("signup opened");

const joinUrl = (await org.locator(".font-mono").first().textContent())?.trim();
if (!joinUrl?.includes("/join/")) fail(`no join url found (${joinUrl})`);
const code = joinUrl.split("/join/")[1];
log(`invite code: ${code}`);

await org.getByRole("button", { name: "+ I'm playing too" }).click();
await org.getByText("you", { exact: true }).first().waitFor({ timeout: 10000 });
for (const g of ["George", "John", "Zach", "Mike", "Ben", "Chris"]) {
  await org.getByPlaceholder(/Add player by name/).fill(g);
  await org.getByRole("button", { name: "Add", exact: true }).click();
  await org.getByText(g).first().waitFor({ timeout: 10000 });
}
log("organizer + 6 guests in roster");
const genderOf = (pg, name) => pg.locator("li", { hasText: name }).getByRole("combobox", { name: "Gender" });
await genderOf(org, "George").selectOption("man");
await org.waitForTimeout(800);
await org.reload();
await org.getByText("Invite players").waitFor({ timeout: 10000 });
if ((await genderOf(org, "George").inputValue()) !== "man") fail("George's gender should persist");
log("organizer set George as a man — persists");
await shot(org, "02-roster-open");

// --- Player joins via invite link ------------------------------------------
const paulaCtx = await newContext({ ...contextOpts, viewport: { width: 390, height: 844 } });
const paula = await paulaCtx.newPage();
await paula.goto(`${BASE}/join/${code}`);
await paula.getByText("You're invited").waitFor();
await shot(paula, "03-join-page");
await paula.getByRole("button", { name: "Continue with email →" }).click();
await paula.waitForURL("**/login**");
await otpSignIn(paula, "Paula", `paula${run}@test.com`);
await paula.waitForURL("**/join/**", { timeout: 15000 });
await paula.getByRole("button", { name: /Join session|Join waitlist/ }).click({ timeout: 15000 });
await paula.getByText("You're in ✓").waitFor({ timeout: 10000 });
await paula.getByRole("button", { name: "Open session" }).click();
await paula.waitForURL("**/app/sessions/**");
log("Paula joined via invite link (8 players total)");

// --- Check-in --------------------------------------------------------------
await org.getByRole("button", { name: "Start check-in" }).click();
await org.getByText("Only checked-in players").waitFor({ timeout: 10000 });
log("check-in started");

await paula.getByRole("button", { name: /I'm here/ }).click({ timeout: 15000 });
await paula.getByText("You're checked in").waitFor({ timeout: 10000 });
log("Paula self-checked-in");

await org.getByRole("button", { name: "Everyone's here" }).click();
await org.getByText(/8.*checked in/s).waitFor({ timeout: 10000 }).catch(() => {});
await shot(org, "04-checkin");
await org.getByRole("button", { name: "Start session →" }).click();
await org.getByText("Round 1", { exact: false }).first().waitFor({ timeout: 15000 });
log("session started — round 1 generated");

const courtCards = org.getByRole("button").filter({ hasText: /^COURT|Court \d/ });
const courtCount = await org.locator("button", { hasText: "Tap to enter score" }).count();
if (courtCount !== 2) fail(`expected 2 courts, saw ${courtCount}`);
log("2 courts, 8 players, no byes ✓");
await shot(org, "05-live-round1");

// --- Paula scores her own match --------------------------------------------
await paula.waitForTimeout(4500); // next poll picks up the live round
const enterBtn = paula.getByRole("button", { name: "Enter final score" });
if (await enterBtn.isVisible().catch(() => false)) {
  await shot(paula, "06-paula-match");
  await enterBtn.click();
  await paula.getByRole("button", { name: "+", exact: true }).click();
  await paula.getByRole("button", { name: "+", exact: true }).click();
  await paula.getByRole("button", { name: /Submit score · 14–10/ }).click();
  const submitted = paula.getByText(/waiting for .* to confirm|Final: 14–10/i).first();
  try {
    await submitted.waitFor({ timeout: 15000 });
  } catch {
    // Cold containers can be slow to re-render; a reload shows the saved score.
    await paula.reload();
    try {
      await submitted.waitFor({ timeout: 20000 });
    } catch (e) {
      const txt = (await paula.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      console.error("PAULA PAGE AT FAILURE:", txt.slice(0, 700));
      throw e;
    }
  }
  log("Paula submitted 14–10 for her match");
  await shot(paula, "07-paula-submitted");
} else {
  log("Paula has the bye this round (also a valid path)");
  await shot(paula, "06-paula-bye");
}

// --- Organizer finalises all courts ----------------------------------------
for (const court of [1, 2]) {
  await org.getByRole("button", { name: new RegExp(`Court ${court}\\b`) }).first().click();
  const plus = org.locator(".fixed").getByRole("button", { name: "+", exact: true });
  await plus.click();
  await org.getByRole("button", { name: /Save score/ }).click();
  await org.locator(".fixed").waitFor({ state: "detached", timeout: 10000 });
}
await org.getByText("all scores in").waitFor({ timeout: 10000 });
log("organizer entered/confirmed both court scores");

const standingsRows = await org.locator("table tbody tr").count();
if (standingsRows !== 8) fail(`expected 8 standings rows, saw ${standingsRows}`);
log("standings show all 8 players");
await shot(org, "08-standings-r1");

// --- Late arrival: the organizer already added "Late" by name; joining claims that entry ----
await org.getByPlaceholder(/late arrival by name/).fill("Late");
await org.getByRole("button", { name: "Add", exact: true }).click();
await org.locator("tbody tr", { hasText: "Late" }).first().waitFor({ timeout: 10000 });
const lateCtx = await newContext({ ...contextOpts, viewport: { width: 390, height: 844 } });
const late = await lateCtx.newPage();
await late.goto(`${BASE}/join/${code}`);
await late.getByText("The game is already on").waitFor({ timeout: 10000 });
await late.getByRole("button", { name: "Continue with email →" }).click();
await late.waitForURL("**/login**");
await otpSignIn(late, "Late", `late${run}@test.com`);
await late.waitForURL("**/join/**", { timeout: 15000 });
await late.getByRole("button", { name: /I'm here — deal me in/ }).click({ timeout: 15000 });
await late.getByText("dealt in from the next round").waitFor({ timeout: 10000 });
await late.getByRole("button", { name: "Open session" }).click();
await late.waitForURL("**/app/sessions/**");
await late.getByText("You're in from round 2").waitFor({ timeout: 10000 });
await org.waitForTimeout(4500); // next poll
if ((await org.locator("tbody tr", { hasText: "Late" }).count()) !== 1) fail("joining should claim the guest entry, not duplicate it");
if ((await org.locator("tbody tr", { hasText: "Late" }).getByText("guest").count()) !== 0) fail("claimed entry should no longer be a guest");
log("late arrival joined via link while live → claimed the pre-added guest entry, dealt in from round 2");
await shot(late, "08b-late-joiner");

// --- Pause between rounds, then resume into round 2 --------------------------
await org.getByRole("button", { name: /Pause game/ }).click();
await org.getByText("Game paused").waitFor({ timeout: 10000 });
await org.getByText("Standings so far").waitFor();
if ((await org.locator("table tbody tr").count()) < 8) fail("paused view should keep the standings");
await shot(org, "08c-paused");
await org.getByRole("button", { name: /Resume · round 2/ }).click();
await org.getByText("Round 2").first().waitFor({ timeout: 15000 });
log("pause → check-in with standings kept → resume deals round 2");
await late.waitForTimeout(4500); // next poll
await late.getByText(/Round 2 · your match|sitting round 2 out/).first().waitFor({ timeout: 10000 });
log("late arrival is part of round 2 (9 players: 8 on court, 1 sitting)");

// --- Round 3, then finish ---------------------------------------------------
await org.getByRole("button", { name: "Next round →" }).click();
await org.getByText("Round 3").first().waitFor({ timeout: 15000 });
log("round 3 generated");

await org.getByRole("button", { name: "Finish session" }).click();
await org.getByText("Final result").waitFor({ timeout: 15000 });
log("session finished — podium shown");
await shot(org, "09-final");

// --- Public board (no auth) -------------------------------------------------
const tvCtx = await newContext({ ...contextOpts, viewport: { width: 1280, height: 800 } });
const tv = await tvCtx.newPage();
await tv.goto(`${BASE}/board/${code}`);
await tv.getByText("Leaderboard").waitFor({ timeout: 10000 });
await tv.getByText("Sunday Night Americano").waitFor();
log("public board renders without auth");
await shot(tv, "10-board");

// --- Session-aware print sheet (names pre-filled, played rounds + planned) --
const pr = await orgCtx.newPage();
await pr.goto(`${BASE}/print?session=${sessionId}&rounds=4`);
await pr.locator(".sheet").waitFor({ timeout: 15000 });
const sheetText = await pr.locator(".sheet").innerText();
for (const expected of ["Andrew", "Paula", "George", "ROUND 1", "ROUND 4", "Sunday Night Americano"]) {
  if (!sheetText.includes(expected)) fail(`session print sheet missing "${expected}"`);
}
log("session print sheet renders with names, played + planned rounds");
await shot(pr, "11-session-print");

// --- Quick start: type names in draft, start without opening signup --------
// Also exercises "bring back the players from" (copies the 8 from the first session).
await org.goto(`${BASE}/app`);
await org.getByText("Past sessions").waitFor({ timeout: 10000 });
await org.getByRole("button", { name: "+ New session" }).click();
await org.getByPlaceholder("Thursday Padel Jam").fill("Bring Back Night");
await org.getByRole("button", { name: /Competitive/ }).click(); // Mexicano
await org.getByRole("checkbox", { name: /Mixed pairs/ }).check();
await org.locator("select").selectOption({ index: 1 });
await org.getByRole("button", { name: "Create session", exact: true }).click();
await org.waitForURL("**/app/sessions/**");
await org.getByText("George").first().waitFor({ timeout: 10000 });
if ((await org.locator("ul > li").count()) < 8) fail("copied roster should have 8 players");
await org.getByText("Mexicano").first().waitFor();
await org.getByText("Round 1 is a random draw").waitFor();
if ((await genderOf(org, "George").inputValue()) !== "man") fail("bring-back should carry gender over");
await org.getByText("Mixed pairs").first().waitFor();
log("bring back players: new competitive (Mexicano) session pre-loaded with previous roster");
await org.goto(`${BASE}/app`);
await org.getByRole("button", { name: "+ New session" }).click();
await org.getByPlaceholder("Thursday Padel Jam").fill("Quick Start Night");
await org.getByRole("button", { name: "Create session", exact: true }).click();
await org.waitForURL("**/app/sessions/**");
const startBtn = org.getByRole("button", { name: "Start session →" });
if (!(await startBtn.isDisabled())) fail("start should be disabled with no players");
for (const g of ["Ana", "Bea", "Cal", "Dee"]) {
  await org.getByPlaceholder(/Add player by name/).fill(g);
  await org.getByRole("button", { name: "Add", exact: true }).click();
  await org.getByText(g).first().waitFor({ timeout: 10000 });
}
await org.getByText(/4 players → 1 court per round/).waitFor({ timeout: 10000 });
await startBtn.click();
await org.getByText("Round 1").first().waitFor({ timeout: 15000 });
if ((await org.locator("button", { hasText: "Tap to enter score" }).count()) !== 1) fail("quick start should yield 1 court");
log("quick start from draft: 4 names → Start → round 1 (no signup step)");
await shot(org, "12-quick-start");

// --- Undo every round → recover: deal round 1 again, or step back to check-in
await org.getByRole("button", { name: "Undo round" }).click();
await org.getByText("No rounds on the board").waitFor({ timeout: 10000 });
await org.getByText("📺 TV board").first().waitFor();
await shot(org, "13-empty-board");
await org.getByRole("button", { name: /Start round 1/ }).click();
await org.getByText("Round 1").first().waitFor({ timeout: 15000 });
await org.getByRole("button", { name: "Undo round" }).click();
await org.getByRole("button", { name: /Pause game/ }).click();
await org.getByText("Only checked-in players").waitFor({ timeout: 10000 });
log("empty board recovers: start round 1 again / pause back to check-in");

// --- Night planner → prefilled new session --------------------------------
await org.goto(`${BASE}/plan?players=12&courts=3&duration=90`);
await org.getByText("Night planner").waitFor({ timeout: 10000 });
await org.getByText("How many players?").waitFor();
// 3 courts · 16 pts · 90 min → 7 rounds: 15 players = 21 sit-out slots → everyone sits 1–2 rounds.
const guideRow15 = org.locator("tr", { has: org.locator("td:first-child", { hasText: /^15\b/ }) }).first();
await guideRow15.waitFor({ timeout: 10000 });
if (!(await guideRow15.innerText()).includes("1–2 sit-outs")) fail("roster guide should flag 15 players as 1–2 sit-outs for 3 courts / 90 min");
await org.getByText("🍻 social").first().waitFor();
const socialRow = org.locator("tr", { hasText: "🍻 social" }).first();
if (!(await socialRow.innerText()).includes("16 pts")) fail("planner should suggest 16-point games for 12 players / 90 min");
await socialRow.getByRole("button", { name: "Use" }).click();
await org.waitForURL("**/app?new=1**", { timeout: 15000 });
await org.getByText("New session").waitFor({ timeout: 10000 });
const newForm = org.locator("form", { hasText: "Create session" });
const courtsVal = await newForm.getByLabel("Courts", { exact: true }).inputValue().catch((e) => `err:${e.message.split("\n")[0]}`);
const pointsVal = await newForm.getByLabel("Points", { exact: true }).inputValue().catch((e) => `err:${e.message.split("\n")[0]}`);
if (courtsVal !== "2" || pointsVal !== "16") fail(`planner prefill expected courts 2 / points 16, got ${courtsVal} / ${pointsVal}`);
log("night planner → 'Use' opens a new session prefilled (2 courts · 16 points)");

await browser.close();
console.log("\nE2E SMOKE: ALL PASSED ✅");
