// End-to-end smoke test against a running `wrangler dev` on :8787.
// Drives the full V1 flow with two users (organizer + player) plus the
// public results. Run with: node test/e2e-smoke.mjs [screenshot-dir]
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
// endpoint (stands in for the inbox), verify, then fill in the profile the
// first time (first/last name, phone, DOB, gender, level — Playtomic optional).
async function otpSignIn(page, name, email, level = "Intermediate") {
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByPlaceholder("••••••").waitFor({ timeout: 10000 });
  const res = await page.request.get(`${BASE}/api/dev/otp?email=${encodeURIComponent(email)}`);
  const body = await res.json();
  const otp = String(body.value ?? "").match(/\d{6}/)?.[0];
  if (!otp) fail(`no OTP found for ${email}: ${JSON.stringify(body)}`);
  await page.getByPlaceholder("••••••").fill(otp); // auto-verifies at 6 digits
  const firstName = page.getByLabel("First name");
  try {
    await firstName.waitFor({ timeout: 8000 });
    await page.getByRole("heading", { name: "Finish signing up" }).waitFor();
    await firstName.fill(name);
    await page.getByLabel("Last name").fill("Test");
    await page.getByLabel("Phone").fill("+34 600 123 456");
    await page.getByLabel("Date of birth").fill("1990-05-04");
    await page.getByRole("group", { name: "Gender" }).getByRole("button", { name: /Man/ }).click();
    await page.getByRole("group", { name: "Your level" }).getByRole("button", { name: new RegExp(level) }).click();
    await page.getByLabel("Playtomic level (optional)").fill("3.5");
    await page.getByRole("button", { name: "Let's play" }).click();
  } catch {
    // existing account with a finished profile — straight through
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

await register(org, "Andrew", `andrew${run}@admin.test`);
log("organizer registered → /app");
await shot(org, "01-home");

// Session-first: no group step — straight from home.
await org.getByRole("button", { name: /New session/ }).click();
await org.getByPlaceholder("Thursday Padel Jam").fill("Sunday Night Americano");
// The form compares game lengths for the roster: 12 players, 2 courts, 90 min.
const lengths = org.getByTestId("game-lengths");
const row18 = lengths.getByRole("button", { name: /^18 pts/ });
await row18.waitFor({ timeout: 10000 });
const row18Text = (await row18.textContent()) ?? "";
if (!/★ best/.test(row18Text) || !/64 ✓2/.test(row18Text)) fail(`18-point row should read 6 rounds, 4 games ✓, 2 sits, ★ best: "${row18Text}"`);
await lengths.getByRole("button", { name: /^24 pts/ }).filter({ hasText: "3–4" }).waitFor();
await lengths.getByRole("button", { name: /^18 pts/ }).click();
if ((await org.getByLabel("Points per game", { exact: true }).inputValue()) !== "18") fail("tapping the 18-point row should set Points to 18");
// Points step with − / +, and any number box can be cleared and retyped (it used to snap back when empty).
await org.getByRole("button", { name: "Increase Points per game" }).click();
await org.getByRole("button", { name: "Increase Points per game" }).click();
if ((await org.getByLabel("Points per game", { exact: true }).inputValue()) !== "20") fail("+ twice from 18 should give 20 points");
// Any number box can be cleared and retyped (it used to snap back when empty, or append digits).
const pointsBox = org.getByLabel("Points per game", { exact: true });
const playersBox = org.getByLabel("Max players", { exact: true });
await pointsBox.click();
await pointsBox.press("Backspace");
if ((await pointsBox.inputValue()) !== "") fail("the Points box should stay empty while retyping");
await pointsBox.pressSequentially("22");
if ((await pointsBox.inputValue()) !== "22") fail("typing 22 into a cleared Points box should give 22");
await playersBox.click();
await playersBox.pressSequentially("14", { delay: 30 }); // tapping selects the number, so typing replaces it
await pointsBox.click(); // leave the box
if ((await playersBox.inputValue()) !== "14") fail(`typing over Max players should give 14, got ${await playersBox.inputValue()}`);
await playersBox.click();
await playersBox.pressSequentially("12", { delay: 30 });
await pointsBox.click();
if ((await playersBox.inputValue()) !== "12") fail(`retyping Max players should replace the number, got ${await playersBox.inputValue()}`);
// Court time: one-tap presets.
await org.getByRole("button", { name: "120", exact: true }).click();
if ((await org.getByLabel("Court time (min)", { exact: true }).inputValue()) !== "120") fail("the 120 preset should set court time");
await org.getByRole("button", { name: "90", exact: true }).click();
log("number boxes: − / + steps, retyping replaces the number (points 22, players 14 → 12), court-time presets");
await shot(org, "01b-game-lengths");
await lengths.getByRole("button", { name: /^24 pts/ }).click();
// Courts: a 1–6 dropdown, then one number dropdown per court (the ones actually booked).
const courtsSelect = org.getByRole("combobox", { name: "Courts", exact: true });
const courtNumbers = async (pg) =>
  Promise.all(
    Array.from({ length: Number(await pg.getByRole("combobox", { name: "Courts", exact: true }).inputValue()) }, (_, i) =>
      pg.getByRole("combobox", { name: `Court number ${i + 1}`, exact: true }).inputValue(),
    ),
  ).then((v) => v.join(","));
if ((await courtNumbers(org)) !== "1,2") fail(`a new session should start on courts 1, 2, got ${await courtNumbers(org)}`);
await courtsSelect.selectOption("3");
if ((await courtNumbers(org)) !== "1,2,3") fail(`3 courts should be numbered 1, 2, 3, got ${await courtNumbers(org)}`);
await courtsSelect.selectOption("2");
await org.getByRole("combobox", { name: "Court number 1", exact: true }).selectOption("3");
await org.getByRole("combobox", { name: "Court number 2", exact: true }).selectOption("4");
if ((await courtNumbers(org)) !== "3,4") fail(`courts should be numbered 3, 4, got ${await courtNumbers(org)}`);
await org.getByRole("combobox", { name: "Court number 2", exact: true }).selectOption("3"); // taken by court 1: they swap
if ((await courtNumbers(org)) !== "4,3") fail(`picking a taken number should swap, got ${await courtNumbers(org)}`);
await org.getByRole("combobox", { name: "Court number 1", exact: true }).selectOption("3");
log("new-session form compares game lengths (12 players, 2 courts: 18 pts → 6 rounds, 4 games each ✓) and a tap picks one");
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

// The organizer plays too: they join with their own invite link like anyone else.
await org.request.post(`${BASE}/api/join/${code}`, { data: {} });
await org.reload();
await org.getByText("you", { exact: true }).first().waitFor({ timeout: 10000 });
for (const g of ["George", "John", "Zach", "Mike", "Ben", "Chris"]) {
  await org.getByPlaceholder(/Add player by name/).fill(g);
  await org.getByRole("button", { name: "Add", exact: true }).click();
  await org.getByText(g).first().waitFor({ timeout: 10000 });
}
log("organizer + 6 guests in roster");
const genderOf = (pg, name) => pg.locator("li", { hasText: name }).getByRole("combobox", { name: "Gender" });
// Gender can always be set (it's needed the moment mixed pairs goes on).
if ((await genderOf(org, "George").count()) !== 1) fail("the organizer should always have a gender picker");
await org.getByRole("button", { name: "Settings" }).click();
await org.getByText("Fine-tune").click();
await org.getByRole("checkbox", { name: /^👩👨 Mixed pairs/ }).check();
await org.getByRole("button", { name: "Save changes" }).click();
await org.getByText("👩👨 Mixed pairs").waitFor({ timeout: 10000 });
await genderOf(org, "George").selectOption("man");
await org.waitForTimeout(800);
await org.reload();
await org.getByText("Invite players").waitFor({ timeout: 10000 });
if ((await genderOf(org, "George").inputValue()) !== "man") fail("George's gender should persist");
log("organizer set George as a man — persists");

// Levels can be set any time (they carry over to later nights); grouping by
// level is off by default and switched on in Settings.
const levelOf = (pg, name) => pg.locator("li", { hasText: name }).getByRole("combobox", { name: "Level" });
if ((await levelOf(org, "George").count()) !== 1) fail("the organizer can set levels before grouping is on");
await levelOf(org, "George").selectOption("4");
await org.waitForTimeout(800);
await org.getByRole("button", { name: "Settings" }).click();
await org.getByText("Fine-tune").click();
await org.getByRole("checkbox", { name: /Group players by playing level/ }).check();
await org.getByRole("button", { name: "Save changes" }).click();
await org.getByText("🎚️ Grouped by level").waitFor({ timeout: 10000 });
// Andrew's own level came in from his profile, George's was just set: 2 of 7.
await org.getByText(/Levels set: 2 of \d+/).waitFor({ timeout: 10000 });
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
await paula.getByRole("button", { name: "Register to join →" }).click();
await paula.waitForURL("**/register**");
await otpSignIn(paula, "Paula", `paula${run}@test.com`);
await paula.waitForURL("**/join/**", { timeout: 15000 });
// Players rate themselves (privately) before joining.
await paula.getByRole("group", { name: "Your level" }).getByRole("button", { name: /Beginner/ }).click();
await paula.getByRole("button", { name: /Join session|Join waitlist/ }).click({ timeout: 15000 });
await paula.getByText("You're in ✓").waitFor({ timeout: 10000 });
await paula.getByRole("button", { name: "Open session" }).click();
await paula.waitForURL("**/app/sessions/**");
log("Paula joined via invite link (8 players total)");
await paula.getByText("George").first().waitFor({ timeout: 10000 });
if ((await paula.getByRole("combobox", { name: "Level" }).count()) !== 0) fail("players must not see Level selects");
const paulaView = await (await paula.request.get(`${BASE}/api/sessions/${sessionId}`)).json();
if (!paulaView.groupByLevel) fail("Paula's view should say the session groups by level");
if (paulaView.players.find((p) => p.id === paulaView.myPlayerId)?.level !== 2) fail("Paula should see her own level (Beginner)");
if (paulaView.players.some((p) => p.id !== paulaView.myPlayerId && p.level != null)) fail("players must not see anyone else's level");
// Changing it from her status card.
await paula.getByRole("group", { name: "Your level" }).getByRole("button", { name: /Intermediate/ }).click();
await paula.waitForTimeout(800);
const orgSeesPaula = await (await org.request.get(`${BASE}/api/sessions/${sessionId}`)).json();
if (orgSeesPaula.players.find((p) => p.name.startsWith("Paula"))?.level !== 3) fail("the organizer should see Paula's own rating (Intermediate)");
log("Paula rated herself Beginner on joining, changed it to Intermediate; only she and the organizer see it");

// --- Start: no check-in step — everyone signed up plays --------------------
if ((await org.getByRole("button", { name: "Start check-in" }).count()) !== 0) fail("check-in is no longer a step");
await shot(org, "04-ready");
await org.getByRole("button", { name: "Start session →" }).click();
// On deck: round 2 is dealt the moment round 1 starts.
const nowCard = org.getByTestId("now-playing");
const nextCard = org.getByTestId("up-next");
await nextCard.getByRole("heading", { name: "Round 2" }).waitFor({ timeout: 15000 });
await nowCard.getByText("Round 1").first().waitFor();
log("session started straight from signup — round 1 in play, round 2 already up next");

const scoreBtn = (pg, court) =>
  pg.getByTestId("now-playing").getByRole("button", { name: new RegExp(`(Enter|Edit) score, Court ${court}$`) });
const courtCount = await nowCard.getByRole("button", { name: /Enter score, Court/ }).count();
if (courtCount !== 2) fail(`expected 2 courts, saw ${courtCount}`);
for (const label of [3, 4]) await scoreBtn(org, label).waitFor();
if ((await org.getByRole("button", { name: /score, Court [12]$/ }).count()) !== 0) fail("courts should be labelled 3 and 4, not 1 and 2");
if ((await org.getByRole("button", { name: "Next round →" }).count()) !== 0) fail("no Next round button: round 2 is already up next");
// 8 players on 2 courts: everyone is finishing round 1, so both round-2 courts are filling.
await nextCard.getByText("2 FILLING").waitFor();
log("2 courts (labelled Court 3 / Court 4), 8 players, no byes ✓; up next shows both courts filling");
await shot(org, "05-live-round1");

// --- Paula scores her own match --------------------------------------------
await paula.waitForTimeout(4500); // next poll picks up the live round
const enterBtn = paula.getByRole("button", { name: "📝 Enter score" });
if (await enterBtn.isVisible().catch(() => false)) {
  await shot(paula, "06-paula-match");
  await enterBtn.click();
  await paula.getByRole("button", { name: "+", exact: true }).click();
  await paula.getByRole("button", { name: "+", exact: true }).click();
  await paula.getByRole("button", { name: /Submit score · 14–10/ }).click();
  // Once her score is in she's moved on: her card is where she stands by for round 2.
  const submitted = paula.getByText(/waiting for .* to confirm|Final: 14–10|Up next · round 2/i).first();
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
  log("Paula submitted 14–10 for her match → her card now says where to stand by for round 2");
  await shot(paula, "07-paula-submitted");
} else {
  log("Paula has the bye this round (also a valid path)");
  await shot(paula, "06-paula-bye");
}

// --- Organizer finalises all courts ----------------------------------------
for (const court of [3, 4]) {
  await scoreBtn(org, court).click();
  const plus = org.locator(".fixed").getByRole("button", { name: "+", exact: true });
  await plus.click();
  await org.getByRole("button", { name: /Save score/ }).click();
  await org.locator(".fixed").waitFor({ state: "detached", timeout: 10000 });
}
await nextCard.getByRole("heading", { name: "Round 3" }).waitFor({ timeout: 15000 });
await nowCard.getByText("Round 2").first().waitFor();
log("organizer entered both court scores → round 2 moves up to now playing, round 3 dealt up next");
await paula.reload();
await paula.getByText(/Up next · round 3|you sit round 3/i).first().waitFor({ timeout: 15000 });
log("Paula sees where she's headed in round 3 while round 2 is still being played");

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
await late.getByRole("button", { name: "Register to join →" }).click();
await late.waitForURL("**/register**");
await otpSignIn(late, "Late", `late${run}@test.com`);
await late.waitForURL("**/join/**", { timeout: 15000 });
await late.getByRole("button", { name: /Join — deal me in/ }).click({ timeout: 15000 });
await late.getByText("in the rotation from the next round").waitFor({ timeout: 10000 });
await late.getByRole("button", { name: "Open session" }).click();
await late.waitForURL("**/app/sessions/**");
await late.getByTestId("now-playing").waitFor({ timeout: 10000 });
await org.waitForTimeout(4500); // next poll
if ((await org.locator("tbody tr", { hasText: "Late" }).count()) !== 1) fail("joining should claim the guest entry, not duplicate it");
if ((await org.locator("tbody tr", { hasText: "Late" }).getByText("guest").count()) !== 0) fail("claimed entry should no longer be a guest");
log("late arrival joined via link while live → claimed the pre-added guest entry, dealt in from round 2");
await shot(late, "08b-late-joiner");

// --- Round 2 (no Pause any more: everything it unlocked works mid-game) ------
if ((await org.getByRole("button", { name: /Pause/ }).count()) !== 0) fail("there's no Pause button during play");
// Round 3 was dealt before Late arrived: reshuffling the round up next brings them in now.
await org.getByRole("button", { name: /Reshuffle round 3/ }).click();
await org.waitForTimeout(1500);
const lateView = await (await late.request.get(`${BASE}/api/sessions/${sessionId}`)).json();
const r2 = lateView.rounds.at(-1);
if (r2.number !== 3) fail(`the round up next should still be round 3, got ${r2.number}`);
if (![...r2.byes, ...r2.matches.flatMap((m) => [...m.a, ...m.b])].includes(lateView.myPlayerId)) fail("late arrival should be in round 3");
log("reshuffling the round up next brings the late arrival into round 3 (9 players: 8 on court, 1 sitting)");

// --- Swap: the sitting player comes on for someone on Court 3 ---------------
const orgApi = async (method, path, data) => {
  const res = await org.request.fetch(`${BASE}/api${path}`, { method, data });
  if (!res.ok()) fail(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return res.json();
};
const sitter = r2.byes[0];
const court3 = r2.matches.find((m) => m.court === 1);
const goingOff = court3.a[0];
const nameIn = (id) => lateView.players.find((p) => p.id === id).name;
await org.getByRole("button", { name: "Swap a player, Court 3" }).click();
// The sheet shows who's partnered with whom: Team 1 / Team 2 bands.
for (const t of ["Team 1", "Team 2"]) await org.locator(".fixed").getByText(t, { exact: true }).waitFor({ timeout: 5000 });
await org.locator(".fixed").getByRole("button", { name: nameIn(goingOff), exact: true }).click();
await org.locator(".fixed").getByText(/Coming on for .* \(Team 1, with /).waitFor({ timeout: 5000 });
await shot(org, "08d-swap-sheet");
await org.locator(".fixed").getByRole("button", { name: new RegExp(`^${nameIn(sitter)}\\s*sitting out`) }).click();
await org.locator(".fixed").waitFor({ state: "detached", timeout: 10000 });
const swapped = (await orgApi("GET", `/sessions/${sessionId}`)).rounds.at(-1);
const c3 = swapped.matches.find((m) => m.id === court3.id);
if (!c3.a.includes(sitter) || c3.a.includes(goingOff)) fail(`swap should put ${nameIn(sitter)} on for ${nameIn(goingOff)}`);
if (!swapped.byes.includes(goingOff) || swapped.byes.includes(sitter)) fail("the player going off should sit the round");
log(`swap: ${nameIn(sitter)} came on for ${nameIn(goingOff)} on Court 3 up next, who now sits round 3`);
await shot(org, "08d-swapped");

// --- Rounds 2 and 3 scored, then finish ----------------------------------------
const half = lateView.pointsPerMatch / 2;
for (const n of [2, 3]) {
  const round = (await orgApi("GET", `/sessions/${sessionId}`)).rounds.find((r) => r.number === n);
  for (const m of round.matches) if (m.scoreA == null) await orgApi("POST", `/matches/${m.id}/score`, { scoreA: half, scoreB: half });
}
const refused = await org.request.post(`${BASE}/api/sessions/${sessionId}/rounds/${swapped.id}/swap`, {
  data: { out: c3.a[0], in: goingOff },
});
if (refused.ok()) fail("a game with a score can't have players swapped");
const dealt = (await orgApi("GET", `/sessions/${sessionId}`)).rounds.map((r) => r.number).join(",");
if (dealt !== "1,2,3,4,5") fail(`rounds 4 and 5 should be dealt on deck once 2 and 3 are scored, got ${dealt}`);
log("rounds 2 and 3 scored → round 4 now playing, round 5 up next");

await org.getByRole("button", { name: "Finish", exact: true }).click();
await org.getByText("Final result").waitFor({ timeout: 15000 });
const kept = (await orgApi("GET", `/sessions/${sessionId}`)).rounds.map((r) => r.number).join(",");
if (kept !== "1,2,3") fail(`finishing should drop the unplayed rounds 4 and 5, kept ${kept}`);
log("session finished — podium shown; the unplayed rounds dealt on deck are dropped");
await shot(org, "09-final");

// --- Public results (no auth): the join link shows them; old board links land there ----
const tvCtx = await newContext({ ...contextOpts, viewport: { width: 390, height: 844 } });
const tv = await tvCtx.newPage();
await tv.goto(`${BASE}/board/${code}`);
await tv.waitForURL(`**/join/${code}`, { timeout: 10000 });
await tv.getByText("Final results").waitFor({ timeout: 10000 });
await tv.getByText("Sunday Night Americano").waitFor();
if ((await tv.locator("table tbody tr").count()) < 8) fail("the join page should list the final standings");
log("public results on the join page without auth (old board link redirects there)");
await shot(tv, "10-results");

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
await org.getByRole("button", { name: /New session/ }).click();
await org.getByPlaceholder("Thursday Padel Jam").fill("Bring Back Night");
// Night types bundle the switches: Open night = Mexicano + beginner court. The rest sits under Fine-tune.
await org.getByRole("button", { name: /Open night/ }).click();
await org.getByText("Fine-tune").click();
if ((await org.getByRole("button", { name: /Competitive/ }).getAttribute("aria-pressed")) !== "true") fail("Open night should select the Mexicano style");
if (!(await org.getByRole("checkbox", { name: /Beginner court/ }).isChecked())) fail("Open night should switch the beginner court on");
await org.getByRole("checkbox", { name: /^👩👨 Mixed pairs/ }).check();
await org.getByRole("checkbox", { name: /Group players by playing level/ }).check();
await org.getByLabel("Bring back the players from").selectOption({ index: 1 });
await org.getByRole("button", { name: "Create session", exact: true }).click();
await org.waitForURL("**/app/sessions/**");
await org.getByText("George").first().waitFor({ timeout: 10000 });
if ((await org.locator("ul > li").count()) < 8) fail("copied roster should have 8 players");
await org.getByText("Mexicano").first().waitFor();
await org.getByText("🌱 Open night").waitFor();
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

// A player who leaves after one big win keeps their score but can't take the
// podium: the table ranks by points per game, and needs half the busiest
// player's games to rank.
const dn = await api("POST", "/sessions", { name: "Drop-out Night", format: "americano", courts: 2, pointsPerMatch: 16 });
for (let i = 1; i <= 8; i++) await api("POST", `/sessions/${dn.id}/players`, { guestName: `D${i}` });
await api("POST", `/sessions/${dn.id}/status`, { action: "start" });
let dd = await api("GET", `/sessions/${dn.id}`);
const [c1, c2] = dd.rounds[0].matches;
await api("POST", `/matches/${c1.id}/score`, { scoreA: 16, scoreB: 0 });
const leaver = c1.a[0];
await api("PATCH", `/sessions/${dn.id}/players/${leaver}`, { action: "drop" });
// Round 2 was dealt up next with them in it: reshuffle it without them.
await api("POST", `/sessions/${dn.id}/rounds`, { regenerate: true });
await api("POST", `/matches/${c2.id}/score`, { scoreA: 8, scoreB: 8 });
for (let r = 2; r <= 4; r++) {
  dd = await api("GET", `/sessions/${dn.id}`);
  for (const m of dd.rounds.find((x) => x.number === r).matches) await api("POST", `/matches/${m.id}/score`, { scoreA: 9, scoreB: 7 });
}
await api("POST", `/sessions/${dn.id}/status`, { action: "complete" });
dd = await api("GET", `/sessions/${dn.id}`);
const leaverRow = dd.standings.find((r) => r.playerId === leaver);
if (leaverRow.points !== 16 || leaverRow.ranked) fail(`leaver should keep 16 points but be unranked: ${JSON.stringify(leaverRow)}`);
if (dd.standings.find((r) => r.ranked).playerId === leaver) fail("leaver must not top the table");
await org.goto(`${BASE}/app/sessions/${dn.id}`);
await org.getByText("Final result").waitFor({ timeout: 10000 });
await org.getByText("too few games to rank").first().waitFor();
const leaverName = dd.players.find((p) => p.id === leaver).name;
if ((await org.locator("p.text-2xl", { hasText: leaverName }).count()) !== 0) fail("leaver must not be the champion");
log("drop-out after one 16–0 win: score kept, listed as 'too few games to rank', not on the podium");

// --- Keep teams together: pair two in the roster, the app pairs the rest ----
const ft = await api("POST", "/sessions", { name: "Teams Night", format: "americano", courts: 2, pointsPerMatch: 16, fixedTeams: true });
for (const g of ["Ana", "Ben", "Cat", "Dan", "Eve", "Fin", "Gus", "Hal"]) await api("POST", `/sessions/${ft.id}/players`, { guestName: g });
let fd = await api("GET", `/sessions/${ft.id}`);
if (!fd.fixedTeams) fail("session should keep teams together");
const idOf = (name) => fd.players.find((p) => p.name === name).id;
await org.goto(`${BASE}/app/sessions/${ft.id}`);
await org.getByText("🤝 Fixed teams").waitFor({ timeout: 10000 });
await org.getByText(/Teams: 0 paired · 8 players paired for you/).waitFor();
const partnerSelect = (pg, name) => pg.locator("li", { hasText: name }).getByRole("combobox", { name: `${name}'s partner` });
await partnerSelect(org, "Ana").selectOption({ label: "🤝 Ben" });
await org.getByText(/Teams: 1 paired · 6 players paired for you/).waitFor({ timeout: 10000 });
if ((await partnerSelect(org, "Ben").inputValue()) !== idOf("Ana")) fail("Ben's select should show Ana once Ana picks Ben");
await shot(org, "14-teams-roster");
log("keep teams together: organizer pairs Ana with Ben in the roster; the hint counts who the app will pair");

await api("POST", `/sessions/${ft.id}/status`, { action: "start" });
fd = await api("GET", `/sessions/${ft.id}`);
const partnerAtStart = new Map(fd.players.map((p) => [p.id, p.partnerId]));
if (fd.players.some((p) => !p.partnerId)) fail("everyone should be paired once round 1 is dealt");
if (partnerAtStart.get(idOf("Ana")) !== idOf("Ben")) fail("Ana and Ben should stay a team");
const teamKey = (t) => [...t].sort().join("|");
const matchups = new Set();
for (let r = 1; r <= 3; r++) {
  fd = await api("GET", `/sessions/${ft.id}`);
  for (const m of fd.rounds.find((x) => x.number === r).matches) {
    for (const t of [m.a, m.b]) if (partnerAtStart.get(t[0]) !== t[1]) fail(`round ${r}: ${t} isn't a fixed team`);
    const key = [teamKey(m.a), teamKey(m.b)].sort().join("~");
    if (matchups.has(key)) fail(`round ${r}: a rematch while unplayed match-ups remain`);
    matchups.add(key);
    const anaWins = [...m.a, ...m.b].includes(idOf("Ana"));
    const aHasAna = m.a.includes(idOf("Ana"));
    await api("POST", `/matches/${m.id}/score`, anaWins ? (aHasAna ? { scoreA: 10, scoreB: 6 } : { scoreA: 6, scoreB: 10 }) : { scoreA: 8, scoreB: 8 });
  }
}
fd = await api("GET", `/sessions/${ft.id}`);
if (fd.teamStandings?.length !== 4) fail(`4 team rows expected, got ${JSON.stringify(fd.teamStandings)}`);
if (fd.teamStandings[0].name !== "Ana & Ben" || fd.teamStandings[0].points !== 30) fail(`Ana & Ben should lead with 30: ${JSON.stringify(fd.teamStandings[0])}`);
if (fd.warnings.some((w) => /partnered/.test(w))) fail(`no partner-repeat warnings with fixed teams: ${fd.warnings}`);
await org.goto(`${BASE}/app/sessions/${ft.id}`);
await org.getByRole("heading", { name: "Team standings" }).waitFor({ timeout: 10000 });
await org.locator("td", { hasText: "Ana & Ben" }).first().waitFor();
await shot(org, "15-teams-live");
log("3 rounds: partners never split, every team met every other team once, team standings lead with 'Ana & Ben — 30'");

// Dropping a player frees their partner, who's paired with the next newcomer.
const cat = idOf("Cat");
const catPartner = partnerAtStart.get(cat);
await api("PATCH", `/sessions/${ft.id}/players/${cat}`, { action: "drop" });
fd = await api("GET", `/sessions/${ft.id}`);
if (fd.players.find((p) => p.id === catPartner).partnerId !== null) fail("dropping Cat should unpair Cat's partner");
await api("POST", `/sessions/${ft.id}/players`, { guestName: "Ivy" });
fd = await api("GET", `/sessions/${ft.id}`);
const ivy = idOf("Ivy");
if (fd.players.find((p) => p.id === ivy).status !== "checked_in") await api("PATCH", `/sessions/${ft.id}/players/${ivy}`, { action: "checkin" });
// The round up next was dealt before Ivy came: reshuffle it.
await api("POST", `/sessions/${ft.id}/rounds`, { regenerate: true });
fd = await api("GET", `/sessions/${ft.id}`);
if (fd.players.find((p) => p.id === ivy).partnerId !== catPartner) fail("Ivy should be paired with Cat's old partner");
for (const m of fd.rounds.at(-1).matches) await api("POST", `/matches/${m.id}/score`, { scoreA: 9, scoreB: 7 });
log("drop Cat → Cat's partner is unpaired, then paired with newcomer Ivy for the next round");

await api("POST", `/sessions/${ft.id}/status`, { action: "complete" });
await org.goto(`${BASE}/app/sessions/${ft.id}`);
await org.getByText("Final result").waitFor({ timeout: 10000 });
const champ = (await org.locator("p.text-2xl").first().textContent())?.trim();
if (!champ?.includes(" & ")) fail(`the champion should be a team, got "${champ}"`);
const board = await (await org.request.get(`${BASE}/api/results/${fd.inviteCode}`)).json();
if (!board.teamStandings?.[0]?.name.includes(" & ")) fail("the public results should list teams");
const me = await api("GET", "/me");
const winner = me.sessions.find((s) => s.id === ft.id)?.winnerName;
if (!winner?.includes(" & ")) fail(`past-session winner should name both partners, got "${winner}"`);
await shot(org, "16-teams-final");
log(`final: champion "${champ}" on the podium, public results and past-sessions list name the team`);
// --- On deck: 12 players on courts 3 and 4 — round 2 is set before round 1 ends ----
const ah = await api("POST", "/sessions", { name: "Ahead Night", format: "americano", courtLabels: ["3", "4"], pointsPerMatch: 16 });
for (let i = 1; i <= 12; i++) await api("POST", `/sessions/${ah.id}/players`, { guestName: `A${i}` });
await api("POST", `/sessions/${ah.id}/status`, { action: "start" });
let ad = await api("GET", `/sessions/${ah.id}`);
if (ad.courts !== 2 || ad.courtLabels.join() !== "3,4") fail(`courts 3 and 4 expected, got ${ad.courts} / ${ad.courtLabels}`);
if (ad.rounds.length !== 2) fail("round 2 should be dealt up next as soon as round 1 starts");
const r2On = ad.rounds[1].matches.flatMap((m) => [...m.a, ...m.b]);
if (!ad.rounds[0].byes.every((p) => r2On.includes(p))) fail("everyone sitting round 1 plays round 2");
await org.goto(`${BASE}/app/sessions/${ah.id}`);
const upNext = org.getByTestId("up-next");
await upNext.getByRole("heading", { name: "Round 2" }).waitFor({ timeout: 10000 });
await upNext.getByText(/on Court [34] now/).first().waitFor();
await upNext.getByText(`Sitting round 2 · 4`).waitFor();
await shot(org, "12a-on-deck");
log("on deck: round 2 dealt at the start — round 1's sitters all play it; up next shows who's finishing where");
// One court finishes: a round-2 game whose four are free and whose court is free is ready.
// The round-2 game with players still finishing waits for *their* court, so that court is the slow one
// (when they all came from one court, finishing that court first would leave both round-2 games free).
const r1On = new Set(ad.rounds[0].matches.flatMap((m) => [...m.a, ...m.b]));
const r2Busy = ad.rounds[1].matches.find((m) => [...m.a, ...m.b].some((p) => r1On.has(p)));
const slow = ad.rounds[0].matches.find((m) => r2Busy && [...m.a, ...m.b].some((p) => [...r2Busy.a, ...r2Busy.b].includes(p))) ?? ad.rounds[0].matches[1];
const fast = ad.rounds[0].matches.find((m) => m !== slow);
await api("POST", `/matches/${fast.id}/score`, { scoreA: 10, scoreB: 6 });
const stillOn = new Set([...slow.a, ...slow.b]);
ad = await api("GET", `/sessions/${ah.id}`);
// A round-2 game whose four are all free moves onto the court that just opened.
const freeFours = ad.rounds[1].matches.filter((m) => [...m.a, ...m.b].every((p) => !stillOn.has(p)));
if (freeFours.some((m) => m.court === slow.court)) fail(`a game whose four are free should move onto the free court, not wait on Court ${slow.court + 2}`);
const readyNow = freeFours.length;
await org.reload();
await upNext.getByRole("heading", { name: "Round 2" }).waitFor({ timeout: 10000 });
if ((await upNext.getByText("Ready · all 4 here").count()) !== readyNow) fail(`${readyNow} round-2 court(s) should read ready once Court ${fast.court + 2} is done`);
if (readyNow > 0) await upNext.getByText(`${readyNow} READY`).waitFor();
// The other court finishes: round 2 moves up, round 3 is dealt up next.
await scoreBtn(org, slow.court + 2).click();
await org.locator(".fixed").getByRole("button", { name: "+", exact: true }).click();
await org.getByRole("button", { name: /Save score/ }).click();
await org.locator(".fixed").waitFor({ state: "detached", timeout: 10000 });
await upNext.getByRole("heading", { name: "Round 3" }).waitFor({ timeout: 15000 });
ad = await api("GET", `/sessions/${ah.id}`);
if (!ad.rounds[0].complete || ad.rounds.length !== 3) fail("round 1 complete and round 3 up next once the second court's score is in");
if (ad.standings.filter((r) => r.played > 0).length !== 8) fail("all 8 round-1 players should have a result");
log(`Court ${fast.court + 2} done → ${readyNow} round-2 court(s) ready; Court ${slow.court + 2} done → round 2 now playing, round 3 up next`);

// --- Live play review: idle courts explained, tap the court, team swaps, settings mid-game ----
const tn = await api("POST", "/sessions", { name: "Six Teams Night", format: "americano", courts: 3, pointsPerMatch: 16, fixedTeams: true });
for (const g of ["T1", "T2", "T3", "T4", "T5", "T6"]) await api("POST", `/sessions/${tn.id}/players`, { guestName: g });
await api("POST", `/sessions/${tn.id}/status`, { action: "start" });
let td = await api("GET", `/sessions/${tn.id}`);
if (td.rounds[0].matches.length !== 1 || td.rounds[0].byes.length !== 2) fail("6 players in teams: one court, one team sitting");
await org.goto(`${BASE}/app/sessions/${tn.id}`);
await org.getByText(/1 court of 3 in play: 6 players \(3 teams\) fill one/).waitFor({ timeout: 10000 });
await org.getByText(/2 more players \(1 team\) open Court 2/).waitFor();
await shot(org, "16b-idle-courts");
// The whole court tile opens the score sheet, not just the button.
await org.getByText("Court 1", { exact: true }).first().click();
await org.getByRole("heading", { name: "Court 1 — score" }).waitFor({ timeout: 5000 });
await org.getByRole("button", { name: "Close" }).click();
// Keep teams together: the sitting team comes on as a team.
const tm = td.rounds[1].matches[0];
const tnName = (id) => td.players.find((p) => p.id === id).name;
await org.getByRole("button", { name: "Swap a team, Court 1" }).click();
await org.locator(".fixed").getByRole("button", { name: `${tnName(tm.a[0])} + ${tnName(tm.a[1])}`, exact: true }).click();
await shot(org, "16c-team-swap");
await org.locator(".fixed").getByRole("button", { name: /sitting out/ }).click();
await org.locator(".fixed").waitFor({ state: "detached", timeout: 10000 });
td = await api("GET", `/sessions/${tn.id}`);
const satBefore = [...tm.a].sort().join("|");
const nowOn = [...td.rounds[1].matches[0].a].sort().join("|");
const satNow = [...td.rounds[1].byes].sort().join("|");
if (satNow !== satBefore) fail(`the team going off (${satBefore}) should sit together, sitting: ${satNow}`);
if (nowOn === satBefore) fail("a new team should be on court");
const onPair = td.rounds[1].matches[0].a;
if (td.players.find((p) => p.id === onPair[0]).partnerId !== onPair[1]) fail("the team coming on should be a real pair");
log("6 players in teams: '1 court of 3 in play' explained; tapping the court opens the score sheet; a whole team swaps on");
// Points can change until the first score; Keep teams together any time.
await api("PATCH", `/sessions/${tn.id}`, { pointsPerMatch: 18 });
await api("POST", `/matches/${td.rounds[0].matches[0].id}/score`, { scoreA: 10, scoreB: 8 });
const lockedPts = await org.request.patch(`${BASE}/api/sessions/${tn.id}`, { data: { pointsPerMatch: 20 } });
if (lockedPts.ok()) fail("points can't change once a score is in");
await api("PATCH", `/sessions/${tn.id}`, { fixedTeams: false });
if ((await api("GET", `/sessions/${tn.id}`)).fixedTeams) fail("Keep teams together should switch off mid-session");
log("points change until the first score; Keep teams together switches off mid-game");

// --- Beginner court on the second rented court ("3"): newbies there, the ladder on 2 and 4 ----
const bc = await api("POST", "/sessions", { name: "Beginner Court Night", format: "mexicano", courtLabels: ["2", "3", "4"], pointsPerMatch: 16, maxPlayers: 20, beginnerCourt: true, beginnerCourtNo: 2 });
for (let i = 1; i <= 8; i++) await api("POST", `/sessions/${bc.id}/players`, { guestName: `L${i}` });
for (let i = 1; i <= 6; i++) await api("POST", `/sessions/${bc.id}/players`, { guestName: `N${i}`, newbie: true });
let bd = await api("GET", `/sessions/${bc.id}`);
if (!bd.beginnerCourt) fail("the session should have the beginner court on");
if (bd.beginnerCourtNo !== 2) fail(`the beginner court should be court 2, got ${bd.beginnerCourtNo}`);
const newbieIds = new Set(bd.players.filter((p) => p.newbie).map((p) => p.id));
if (newbieIds.size !== 6) fail(`6 newbies should be tagged, got ${newbieIds.size}`);
await api("POST", `/sessions/${bc.id}/status`, { action: "start" });
bd = await api("GET", `/sessions/${bc.id}`);
if (!bd.poolsActive) fail("the beginner court should be running with 6 newbies among 14");
for (const r of bd.rounds) {
  const court1 = r.matches.find((m) => m.court === 2);
  if (!court1 || ![...court1.a, ...court1.b].every((p) => newbieIds.has(p))) fail(`round ${r.number}: court 2 should be four newbies`);
  for (const m of r.matches.filter((m) => m.court !== 2)) if ([...m.a, ...m.b].some((p) => newbieIds.has(p))) fail(`round ${r.number}: a newbie is on a ladder court`);
  if (r.byes.length !== 2 || !r.byes.every((p) => newbieIds.has(p))) fail(`round ${r.number}: the two sitting should both be newbies`);
}
if (!bd.beginnerStandings || bd.beginnerStandings.length !== 6) fail("the beginner court should have its own 6-row table");
if (bd.standings.length !== 8) fail(`the ladder table should hold the 8 ladder players, got ${bd.standings.length}`);
await org.goto(`${BASE}/app/sessions/${bc.id}`);
await org.getByTestId("now-playing").getByTestId("beginner-court").waitFor({ timeout: 10000 });
await org.getByText("🌱 Beginner court 3").waitFor();
await org.getByTestId("up-next").getByText(/Sitting · beginner court · 2/).waitFor();
await org.getByText("Ladder", { exact: true }).waitFor();
await org.getByText(/Beginner court · Court 3/).waitFor();
const switches = await org.getByRole("switch", { name: "Newbie", exact: true }).count();
if (switches !== 14) {
  await shot(org, "17-beginner-court-fail");
  fail(`every roster row should carry the Newbie switch for the organizer (found ${switches}; rows: ${await org.locator("tbody tr").count()})`);
}
await shot(org, "17-beginner-court");
log("beginner court: 14 players on courts 2/3/4 — four newbies on Court 3 (the chosen one) each round, none on the ladder courts, two tables");
// Settings: the beginner court is a dropdown; moving it to Court 4 applies from the next deal.
await org.getByRole("button", { name: "Settings" }).click();
await org.getByText("Fine-tune").click();
const bcSelect = org.getByRole("combobox", { name: "Beginner court" });
if ((await bcSelect.inputValue()) !== "2") fail("Settings should show the chosen beginner court (court 2 = \"3\")");
await bcSelect.selectOption("3");
await org.getByRole("button", { name: "Save changes" }).click();
await org.getByText("🌱 Beginner court 4").waitFor({ timeout: 10000 });
await api("POST", `/sessions/${bc.id}/rounds`, { regenerate: true });
bd = await api("GET", `/sessions/${bc.id}`);
const moved = bd.rounds[1].matches.find((m) => m.court === 3);
if (!moved || ![...moved.a, ...moved.b].every((p) => newbieIds.has(p))) fail("after moving the beginner court to court 3, the re-dealt round should put the newbies there");
await bcSelect.waitFor({ state: "hidden" }).catch(() => {});
await org.getByRole("button", { name: "Settings" }).click();
await org.getByText("Fine-tune").click();
await org.getByRole("combobox", { name: "Beginner court" }).selectOption("2");
await org.getByRole("button", { name: "Save changes" }).click();
await org.getByText("🌱 Beginner court 3").waitFor({ timeout: 10000 });
await api("POST", `/sessions/${bc.id}/rounds`, { regenerate: true });
bd = await api("GET", `/sessions/${bc.id}`);
log("beginner court: Settings moves it to Court 4 and back; the round on deck follows");
// The pools don't swap across: a newbie on court 1 can't trade with a ladder player.
const onDeck = bd.rounds[1];
const nbOut = onDeck.matches.find((m) => m.court === 2).a[0];
const ladderIn = onDeck.matches.find((m) => m.court === 1).a[0];
const crossSwap = await org.request.post(`${BASE}/api/sessions/${bc.id}/rounds/${onDeck.id}/swap`, { data: { out: nbOut, in: ladderIn } });
if (crossSwap.ok()) fail("a newbie must not swap with a ladder player");
// Move up: untag a newbie in the roster → reshuffle the round on deck → they're on a ladder court.
const mover = bd.players.find((p) => p.newbie);
await org.getByRole("switch", { name: "Newbie", checked: true }).first().click();
await org.waitForFunction(
  async ([id, pid]) => !(await (await fetch(`/api/sessions/${id}`)).json()).players.find((p) => p.id === pid).newbie,
  [bc.id, mover.id],
  { timeout: 10000 },
);
await api("POST", `/sessions/${bc.id}/rounds`, { regenerate: true });
bd = await api("GET", `/sessions/${bc.id}`);
const redealt = bd.rounds[1];
if (redealt.matches.find((m) => m.court === 2) && [...redealt.matches.find((m) => m.court === 2).a, ...redealt.matches.find((m) => m.court === 2).b].includes(mover.id)) fail("the moved-up player should leave the beginner court");
if (!redealt.matches.some((m) => m.court !== 2 && [...m.a, ...m.b].includes(mover.id)) && !redealt.byes.includes(mover.id)) fail("the moved-up player should be in the ladder now");
if (bd.standings.length !== 9 || bd.beginnerStandings.length !== 5) fail("the tables should follow the tag: 9 in the ladder, 5 on the beginner court");
// A player who registered as a Newbie arrives already tagged for the beginner court.
const niaCtx = await newContext({ ...contextOpts, viewport: { width: 390, height: 844 } });
const nia = await niaCtx.newPage();
await nia.goto(`${BASE}/join/${bd.inviteCode}`);
await nia.getByRole("button", { name: "Register to join →" }).click();
await nia.waitForURL("**/register**");
await otpSignIn(nia, "Nia", `nia${run}@test.com`, "Newbie");
await nia.waitForURL("**/join/**", { timeout: 15000 });
if ((await nia.getByRole("group", { name: "Your level" }).getByRole("button", { name: /Newbie/ }).getAttribute("aria-pressed")) !== "true") fail("the join page should preselect the profile's Newbie level");
await nia.getByRole("button", { name: /Join — deal me in/ }).click({ timeout: 15000 });
await nia.getByText(/You're in ✓/).waitFor({ timeout: 10000 });
bd = await api("GET", `/sessions/${bc.id}`);
const niaRow = bd.players.find((p) => p.name.startsWith("Nia"));
if (!niaRow || niaRow.level !== 1 || !niaRow.newbie) fail(`a self-declared Newbie should join at level 1 and tagged newbie, got ${JSON.stringify(niaRow)}`);
if (bd.beginnerStandings.length !== 6) fail("the Newbie who just joined should be on the beginner court's table");
log("a player who registered as a Newbie joins already tagged for the beginner court");
// Results carry both tables to the public page.
for (const m of bd.rounds[0].matches) await api("POST", `/matches/${m.id}/score`, { scoreA: 10, scoreB: 6 });
await api("POST", `/sessions/${bc.id}/status`, { action: "complete" });
const pub = await (await org.request.get(`${BASE}/api/results/${bd.inviteCode}`)).json();
if (!pub.beginnerStandings || !pub.beginnerStandings.some((r) => r.played > 0)) fail("public results should carry the beginner court's table");
if (pub.standings.some((r) => newbieIds.has(r.playerId) && r.playerId !== mover.id)) fail("newbies stay off the ladder table");
log("beginner court: cross-pool swap refused; untagging moves a player up on the next deal; results carry both tables");

await org.goto(`${BASE}/app`);
await org.getByRole("button", { name: /New session/ }).click();
await org.getByPlaceholder("Thursday Padel Jam").fill("Quick Start Night");
await org.getByRole("button", { name: "Create session", exact: true }).click();
await org.waitForURL("**/app/sessions/**");
const startBtn = org.getByRole("button", { name: "Start session →" });
if ((await startBtn.count()) !== 0) fail("no Start button until there's a court's worth of players");
for (const g of ["Ana", "Bea", "Cal", "Dee"]) {
  await org.getByPlaceholder(/Add player by name/).fill(g);
  await org.getByRole("button", { name: "Add", exact: true }).click();
  await org.getByText(g).first().waitFor({ timeout: 10000 });
}
await org.getByText(/4 players · 1 court → nobody sits out/).waitFor({ timeout: 10000 });
await startBtn.click();
await org.getByText("Round 1").first().waitFor({ timeout: 15000 });
if ((await org.getByTestId("now-playing").getByRole("button", { name: /Enter score, Court/ }).count()) !== 1) fail("quick start should yield 1 court");
log("quick start from draft: 4 names → Start → round 1 (no signup step)");
await shot(org, "12-quick-start");

// --- Undo every round → recover: deal round 1 again, or step back to check-in
await org.getByRole("button", { name: "Undo round 2" }).click();
await org.getByRole("button", { name: "Undo round 1" }).click();
await org.getByText("No rounds on the board").waitFor({ timeout: 10000 });
await shot(org, "13-empty-board");
await org.getByRole("button", { name: /Start round 1/ }).click();
await org.getByTestId("up-next").getByRole("heading", { name: "Round 2" }).waitFor({ timeout: 15000 });
await org.getByRole("button", { name: "Undo round 2" }).click();
await org.getByRole("button", { name: "Undo round 1" }).click();
await org.getByRole("button", { name: /Back to setup/ }).click();
await org.getByText("Game day?").waitFor({ timeout: 10000 });
log("empty board recovers: start round 1 again / back to setup");

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
// 12 players on 2 courts in 90 min: 18-point games give everyone exactly 4 games.
await org.getByTestId("equal-games").filter({ hasText: "18-point games → 6 rounds, everyone plays 4" }).waitFor();
await org.getByRole("button", { name: "Use 18 points" }).click();
await org.getByText(/^6 rounds/).first().waitFor();
await onCourtBox.filter({ hasText: /^On court4 games/ }).waitFor();
if ((await org.getByRole("radio", { name: "18", exact: true }).getAttribute("aria-checked")) !== "true") fail("the 18 chip should be selected");
// 16 players → the split-in-two warning.
for (let i = 0; i < 4; i++) await org.getByRole("button", { name: "Increase players" }).click();
await org.getByText(/splits into two groups of 8/).waitFor();
for (let i = 0; i < 4; i++) await org.getByRole("button", { name: "Decrease players" }).click();
await roundSplit.filter({ hasText: "8 on court · 4 off" }).waitFor();
log("night planner: suggests equal-games points (12 players → 18 points, 4 games each) and flags 16 players");
await org.getByRole("button", { name: /Create this session/ }).click();
await org.waitForURL("**/app?new=1**", { timeout: 15000 });
await org.getByRole("heading", { name: "New session" }).waitFor({ timeout: 10000 });
const newForm = org.locator("form", { hasText: "Create session" });
const formVal = (label) =>
  newForm.getByLabel(label, { exact: true }).inputValue().catch((e) => `err:${e.message.split("\n")[0]}`);
const [courtsVal, pointsVal, maxVal] = [await courtNumbers(org), await formVal("Points per game"), await formVal("Max players")];
if (courtsVal !== "1,2" || pointsVal !== "18" || maxVal !== "12")
  fail(`planner prefill expected courts 2 / points 18 / max 12, got ${courtsVal} / ${pointsVal} / ${maxVal}`);
log("night planner → 'Create a session' opens the form prefilled (2 courts · 18 points · 12 max)");

// --- Signed-out planner hand-off: sign in first, then land on the prefilled form ----
const visitorCtx = await newContext({ ...contextOpts, viewport: { width: 390, height: 844 } });
const visitor = await visitorCtx.newPage();
await visitor.goto(`${BASE}/plan?players=11&courts=2&duration=90&points=16`);
await visitor.getByRole("button", { name: /Create this session/ }).click();
await visitor.waitForURL("**/login**", { timeout: 15000 });
await otpSignIn(visitor, "Vic", `vic${run}@admin.test`);
await visitor.waitForURL("**/app?new=1**", { timeout: 15000 });
await visitor.getByRole("heading", { name: "New session" }).waitFor({ timeout: 10000 });
const visitorForm = visitor.locator("form", { hasText: "Create session" });
const visitorVal = (label) =>
  visitorForm.getByLabel(label, { exact: true }).inputValue().catch((e) => `err:${e.message.split("\n")[0]}`);
const [vCourts, vPoints, vMax] = [await courtNumbers(visitor), await visitorVal("Points per game"), await visitorVal("Max players")];
if (vCourts !== "1,2" || vPoints !== "16" || vMax !== "11")
  fail(`signed-out hand-off expected courts 2 / points 16 / max 11 after sign-in, got ${vCourts} / ${vPoints} / ${vMax}`);
log("signed-out planner → sign in → lands on the prefilled form (2 courts · 16 points · 11 max)");

await browser.close();
console.log("\nE2E SMOKE: ALL PASSED ✅");
