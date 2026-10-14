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

// Group players by playing level: off by default, switched on in Settings, then
// the organizer's roster grows a Level select per player.
const levelOf = (pg, name) => pg.locator("li", { hasText: name }).getByRole("combobox", { name: "Level" });
if ((await levelOf(org, "George").count()) !== 0) fail("no Level selects until the session groups by level");
await org.getByRole("button", { name: "Settings" }).click();
await org.getByRole("checkbox", { name: /Group players by playing level/ }).check();
await org.getByRole("button", { name: "Save changes" }).click();
await org.getByText("🎚️ Grouped by level").waitFor({ timeout: 10000 });
await levelOf(org, "George").selectOption("4");
await org.getByText(/Levels: 1 of \d+ set/).waitFor({ timeout: 10000 });
await org.reload();
await org.getByText("Invite players").waitFor({ timeout: 10000 });
if ((await levelOf(org, "George").inputValue()) !== "4") fail("George's level should persist");
log("grouping by level switched on; George set to Advanced — persists");
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
await paula.getByText("George").first().waitFor({ timeout: 10000 });
if ((await paula.getByRole("combobox", { name: "Level" }).count()) !== 0) fail("players must not see Level selects");
const paulaView = await (await paula.request.get(`${BASE}/api/sessions/${sessionId}`)).json();
if (!paulaView.groupByLevel) fail("Paula's view should say the session groups by level");
if (paulaView.players.some((p) => p.level != null)) fail("levels must not reach players' API responses");
log("levels are organizer-only: no selects for Paula, null in her API payload");

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
await org.getByRole("checkbox", { name: /Group players by playing level/ }).check();
await org.locator("select").selectOption({ index: 1 });
await org.getByRole("button", { name: "Create session", exact: true }).click();
await org.waitForURL("**/app/sessions/**");
await org.getByText("George").first().waitFor({ timeout: 10000 });
if ((await org.locator("ul > li").count()) < 8) fail("copied roster should have 8 players");
await org.getByText("Mexicano").first().waitFor();
await org.getByText("First games are grouped by playing level.").waitFor();
await org.getByText("🎚️ Grouped by level").waitFor();
if ((await genderOf(org, "George").inputValue()) !== "man") fail("bring-back should carry gender over");
if ((await levelOf(org, "George").inputValue()) !== "4") fail("bring-back should carry level over");
await org.getByText("Mixed pairs").first().waitFor();
log("bring back players: new competitive (Mexicano) session, grouped by level, pre-loaded with previous roster + levels");
// A full 18-player roster comes back in one go (D1 caps statement parameters,
// so the copy is chunked; it used to 500 from 12 players up).
const api = async (method, path, data) => {
  const res = await org.request.fetch(`${BASE}/api${path}`, { method, data });
  if (!res.ok()) fail(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return res.json();
};
const big = await api("POST", "/sessions", { name: "Eighteen Night", format: "mexicano", courts: 2, maxPlayers: 18, groupByLevel: true });
for (let i = 1; i <= 18; i++) await api("POST", `/sessions/${big.id}/players`, { guestName: `Guest ${i}` });
const bigDetail = await api("GET", `/sessions/${big.id}`);
await api("PATCH", `/sessions/${big.id}/players/${bigDetail.players[0].id}`, { action: "set_level", level: 2 });
const again = await api("POST", "/sessions", { name: "Eighteen Again", format: "mexicano", courts: 2, maxPlayers: 18, copyPlayersFrom: big.id });
const againDetail = await api("GET", `/sessions/${again.id}`);
if (againDetail.players.length !== 18) fail(`bring-back should copy all 18 players (got ${againDetail.players.length})`);
if (!againDetail.players.some((p) => p.level === 2)) fail("bring-back should copy levels on a big roster too");
log("bring back an 18-player roster: all 18 copied with their levels");
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

// --- Night planner: 4 dials → on-court / off-court split → prefilled new session ----
await org.goto(`${BASE}/plan?players=11&courts=2&duration=90&points=16`);
await org.getByText("Night planner").waitFor({ timeout: 10000 });
const roundSplit = org.getByTestId("round-split");
const onCourtBox = org.getByTestId("on-court");
const offCourtBox = org.getByTestId("off-court");
// 11 players · 2 courts · 16 pts · 90 min → 7 rounds: 8 on court, 3 off; everyone plays 5–6 and sits 1–2.
await roundSplit.filter({ hasText: "8 on court · 3 off" }).waitFor({ timeout: 10000 });
await org.getByText(/^7 rounds/).first().waitFor();
await onCourtBox.filter({ hasText: "5–6 games" }).waitFor();
await offCourtBox.filter({ hasText: "1–2 sit-outs" }).waitFor();
if ((await org.locator("[data-tone]").getAttribute("data-tone")) !== "social") fail("11 players / 2 courts / 16 pts should be the social sweet spot");
// Switch scoring to 24 → 5 rounds, 3–4 games each.
await org.getByRole("radio", { name: "24", exact: true }).click();
await org.getByText(/^5 rounds/).first().waitFor();
await onCourtBox.filter({ hasText: "3–4 games" }).waitFor();
// A third court: 11 players can only fill 2 of 3.
await org.getByRole("button", { name: "Increase courts" }).click();
await org.getByText(/fill 2 of 3 courts/).waitFor();
await org.getByRole("button", { name: "Decrease courts" }).click();
// One more player → 12: 4 off each round.
await org.getByRole("button", { name: "Increase players" }).click();
await roundSplit.filter({ hasText: "8 on court · 4 off" }).waitFor();
log("night planner: players / courts / scoring dials update the on-court / off-court split");
await org.getByRole("button", { name: /Create this session/ }).click();
await org.waitForURL("**/app?new=1**", { timeout: 15000 });
await org.getByRole("heading", { name: "New session" }).waitFor({ timeout: 10000 });
const newForm = org.locator("form", { hasText: "Create session" });
const formVal = (label) =>
  newForm.getByLabel(label, { exact: true }).inputValue().catch((e) => `err:${e.message.split("\n")[0]}`);
const [courtsVal, pointsVal, maxVal] = [await formVal("Courts"), await formVal("Points"), await formVal("Max players")];
if (courtsVal !== "2" || pointsVal !== "24" || maxVal !== "12")
  fail(`planner prefill expected courts 2 / points 24 / max 12, got ${courtsVal} / ${pointsVal} / ${maxVal}`);
log("night planner → 'Create a session' opens the form prefilled (2 courts · 24 points · 12 max)");

// --- Signed-out planner hand-off: sign in first, then land on the prefilled form ----
const visitorCtx = await newContext({ ...contextOpts, viewport: { width: 390, height: 844 } });
const visitor = await visitorCtx.newPage();
await visitor.goto(`${BASE}/plan?players=11&courts=2&duration=90&points=16`);
await visitor.getByRole("button", { name: /Create this session/ }).click();
await visitor.waitForURL("**/login**", { timeout: 15000 });
await otpSignIn(visitor, "Vic", `vic${run}@test.com`);
await visitor.waitForURL("**/app?new=1**", { timeout: 15000 });
await visitor.getByRole("heading", { name: "New session" }).waitFor({ timeout: 10000 });
const visitorForm = visitor.locator("form", { hasText: "Create session" });
const visitorVal = (label) =>
  visitorForm.getByLabel(label, { exact: true }).inputValue().catch((e) => `err:${e.message.split("\n")[0]}`);
const [vCourts, vPoints, vMax] = [await visitorVal("Courts"), await visitorVal("Points"), await visitorVal("Max players")];
if (vCourts !== "2" || vPoints !== "16" || vMax !== "11")
  fail(`signed-out hand-off expected courts 2 / points 16 / max 11 after sign-in, got ${vCourts} / ${vPoints} / ${vMax}`);
log("signed-out planner → sign in → lands on the prefilled form (2 courts · 16 points · 11 max)");

await browser.close();
console.log("\nE2E SMOKE: ALL PASSED ✅");
