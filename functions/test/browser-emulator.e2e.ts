/* eslint-disable */
// @ts-nocheck

import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {deleteApp, initializeApp} from "firebase-admin/app";
import {
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import {chromium} from "playwright-core";

const PROJECT_ID = "demo-lukes-picks-local";
const BASE_URL = "http://127.0.0.1:5002";
const AUTH_HOST = "127.0.0.1:9099";
const FIRESTORE_HOST = "127.0.0.1:8080";
const FUNCTIONS_HOST = "127.0.0.1:5001";
const HOSTING_HOST = "127.0.0.1:5002";
const ACTION_TIMEOUT_MS = 30_000;
const PROVIDER_TIMEOUT_MS = 120_000;
const FULL_RUN_TIMEOUT_MS = 600_000;
const NAVIGATION_PATHS = {
  Dashboard: "/dashboard",
  "Draft slate": "/catalog",
  "Make picks": "/picks",
  Results: "/results",
  Standings: "/standings",
  History: "/history",
  Members: "/members",
  "Admin review": "/admin",
  Settings: "/settings",
};

function requireExactEnvironment(name, expected) {
  assert.equal(
    process.env[name],
    expected,
    `${name} must be exactly ${expected}; refusing any other target.`,
  );
}

function assertLocalTarget() {
  requireExactEnvironment("GCLOUD_PROJECT", PROJECT_ID);
  requireExactEnvironment("GOOGLE_CLOUD_PROJECT", PROJECT_ID);
  requireExactEnvironment("FIREBASE_AUTH_EMULATOR_HOST", AUTH_HOST);
  requireExactEnvironment("FIRESTORE_EMULATOR_HOST", FIRESTORE_HOST);
  requireExactEnvironment("FUNCTIONS_EMULATOR_HOST", FUNCTIONS_HOST);
  requireExactEnvironment("FIREBASE_HOSTING_EMULATOR_HOST", HOSTING_HOST);
  assert.equal(
    process.env.ALLOW_THESPORTSDB_TEST_PROVIDER,
    "true",
    "The internal schedule adapter must be explicitly enabled.",
  );
  assert.equal(
    new URL(BASE_URL).hostname,
    "127.0.0.1",
    "The browser target must remain on loopback.",
  );
  if (process.env.FIREBASE_CONFIG !== undefined) {
    const config = JSON.parse(process.env.FIREBASE_CONFIG);
    assert.equal(
      config.projectId,
      PROJECT_ID,
      "FIREBASE_CONFIG points at an unexpected project.",
    );
  }
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert.ok(
    executable,
    "System Chrome/Chromium was not found. Set CHROME_PATH to its executable.",
  );
  return executable;
}

function callableUrl(name) {
  return `http://${FUNCTIONS_HOST}/${PROJECT_ID}/us-central1/${name}`;
}

function isCallableResponse(response, name) {
  return (
    response.request().method() === "POST" &&
    response.url() === callableUrl(name)
  );
}

function callableResponse(page, name, timeout = ACTION_TIMEOUT_MS) {
  return page.waitForResponse(
    (response) => isCallableResponse(response, name),
    {timeout},
  );
}

async function parseCallable(response) {
  const body = await response.json();
  const envelope = body?.data ?? body?.result;
  assert.equal(
    response.ok(),
    true,
    `Callable ${response.url()} failed: ${JSON.stringify(body)}`,
  );
  assert.equal(
    envelope?.ok,
    true,
    `Malformed callable response: ${response.url()} ${JSON.stringify(body)}`,
  );
  return envelope.result;
}

function decodeUid(token) {
  const parts = token.split(".");
  assert.equal(parts.length, 3, "Expected an emulator Firebase ID token.");
  const claims = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8"),
  );
  const uid = claims.user_id ?? claims.sub;
  assert.equal(typeof uid, "string", "Firebase ID token did not contain a UID.");
  assert.ok(uid.length > 0, "Firebase ID token UID was empty.");
  return uid;
}

function textLocator(page, value) {
  return page
    .getByText(value, {exact: false})
    .or(page.getByLabel(value, {exact: false}))
    .first();
}

function button(page, name) {
  return page
    .getByRole("button", {name, exact: typeof name === "string"})
    .or(page.getByLabel(name, {exact: typeof name === "string"}))
    .first();
}

function textbox(page, name) {
  return page
    .getByRole("textbox", {name, exact: false})
    .or(page.getByLabel(name, {exact: false}))
    .first();
}

async function fillFlutterTextbox(page, name, value) {
  const field = textbox(page, name);
  let observed = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Flutter creates/focuses its editable DOM element after the semantics
    // click. Give that handoff a moment so the first character is not consumed
    // while activating the field.
    await field.click();
    await page.waitForTimeout(200);
    await field.fill(value);
    observed = await field.inputValue();
    if (observed !== value) continue;

    await field.press("Tab");
    await page.waitForTimeout(100);
    observed = await field.inputValue();
    if (observed === value) return field;
  }
  throw new Error(
    `${name} text did not remain in Flutter's input; ` +
      `expected=${JSON.stringify(value)} observed=${JSON.stringify(observed)}`,
  );
}

function navigationItem(page, label) {
  return page
    .getByRole("tab", {name: label, exact: true})
    .or(page.getByRole("button", {name: label, exact: true}))
    .or(page.getByText(label, {exact: true}))
    .first();
}

async function expectText(page, value, timeout = ACTION_TIMEOUT_MS) {
  await enableFlutterSemantics(page);
  await textLocator(page, value).waitFor({state: "visible", timeout});
}

async function expectDashboard(page, timeout = ACTION_TIMEOUT_MS) {
  await page.waitForURL(
    (url) => url.pathname === "/dashboard",
    {timeout},
  );
  await enableFlutterSemantics(page);
}

async function enableFlutterSemantics(page) {
  await page.locator("flutter-view, flt-view, flt-glass-pane").first().waitFor({
    state: "attached",
    timeout: ACTION_TIMEOUT_MS,
  });
  const semanticsNodes = page.locator(
    "flt-semantics-host flt-semantics",
  );
  if (await semanticsNodes.count()) return;
  const placeholder = page.locator("flt-semantics-placeholder");
  await placeholder
    .first()
    .waitFor({state: "attached", timeout: 5_000})
    .catch(() => {});
  if (await placeholder.count()) {
    await placeholder
      .first()
      .evaluate((element) => element.click())
      .catch(() => {});
  }
  await semanticsNodes.first().waitFor({
    state: "attached",
    timeout: ACTION_TIMEOUT_MS,
  });
}

async function waitUntil(label, predicate, timeout = ACTION_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Timed out waiting for ${label}.${lastError ? ` ${lastError}` : ""}`,
  );
}

async function step(name, operation) {
  const startedAt = Date.now();
  console.log(`\n[E2E] ${name}`);
  const result = await operation();
  console.log(`[E2E] PASS ${name} (${Date.now() - startedAt} ms)`);
  return result;
}

async function createBrowserUser(browser, label) {
  const diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    failedResponses: [],
    allowedNoise: [],
  };
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1000},
    locale: "en-US",
    timezoneId: "America/Chicago",
  });
  await context.grantPermissions(["local-network-access"], {
    origin: BASE_URL,
  });
  await context.route(`${BASE_URL}/**`, async (route) => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.resourceType() !== "document") {
      await route.continue();
      return;
    }
    const url = new URL(request.url());
    assert.equal(
      url.origin,
      BASE_URL,
      "CSP interception is restricted to the loopback Hosting Emulator.",
    );
    const response = await route.fetch();
    const headers = {...response.headers()};
    assert.match(
      headers["content-type"] ?? "",
      /^text\/html(?:;|$)/i,
      "Only loopback HTML documents may bypass production CSP in this test.",
    );
    delete headers["content-security-policy"];
    await route.fulfill({response, headers});
  });
  await context.addInitScript((expectedAlias) => {
    const url = new URL(window.location.href);
    const alias = url.searchParams.get("e2eUser");
    const allowed = ["owner", "member-a", "member-b"];
    if (
      url.origin === "http://127.0.0.1:5002" &&
      alias === expectedAlias &&
      allowed.includes(alias)
    ) {
      window.sessionStorage.setItem(
        "lukes-picks-browser-e2e-user",
        alias,
      );
    }
  }, label);
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location().url ?? "";
      const providerArtworkFallback =
        /^https:\/\/r[23]\.thesportsdb\.com\//.test(location) &&
        message.text().includes("Failed to load resource");
      const providerArtworkCorsFallback =
        /^Access to XMLHttpRequest at 'https:\/\/r[23]\.thesportsdb\.com\/images\/media\/team\/badge\/[A-Za-z0-9._/-]+' from origin 'http:\/\/127\.0\.0\.1:5002' has been blocked by CORS policy:/.test(
          message.text(),
        );
      const record = {
        text: message.text(),
        location,
      };
      if (providerArtworkFallback || providerArtworkCorsFallback) {
        diagnostics.allowedNoise.push({
          kind: providerArtworkCorsFallback
            ? "provider-artwork-cors-fallback"
            : "provider-artwork-fallback",
          ...record,
        });
      } else {
        diagnostics.consoleErrors.push(record);
      }
    }
  });
  page.on("pageerror", (error) => {
    diagnostics.pageErrors.push(error.stack ?? error.message);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    const url = request.url();
    const abortedFirestoreListen =
      url.startsWith(`http://${FIRESTORE_HOST}/`) &&
      url.includes("google.firestore.v1.Firestore/Listen/channel") &&
      failure.includes("ERR_ABORTED");
    if (abortedFirestoreListen) {
      diagnostics.allowedNoise.push({
        kind: "aborted-firestore-listen-on-navigation",
        url,
        failure,
      });
      return;
    }
    if (url.startsWith("http://127.0.0.1:")) {
      diagnostics.failedRequests.push({url, failure});
    }
  });
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      response.url().startsWith("http://127.0.0.1:")
    ) {
      diagnostics.failedResponses.push({
        url: response.url(),
        status: response.status(),
      });
    }
  });
  try {
    await page.goto(`${BASE_URL}/?e2eUser=${encodeURIComponent(label)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(
      (url) => url.pathname === "/sign-in",
      {timeout: ACTION_TIMEOUT_MS},
    );
    await enableFlutterSemantics(page);
    await expectText(page, "Welcome to the arena");
    const profileResponsePromise = callableResponse(page, "ensureUserProfile");
    await button(page, /^Continue with Google/).click();
    const profileResponse = await profileResponsePromise;
    await parseCallable(profileResponse);
    const authorization = profileResponse.request().headers().authorization;
    assert.match(
      authorization ?? "",
      /^Bearer /,
      `${label} sign-in did not send a Firebase ID token.`,
    );
    const token = authorization.slice("Bearer ".length);
    const uid = decodeUid(token);
    await expectText(page, "Your next rivalry starts here.");
    return {context, page, token, uid, label, diagnostics};
  } catch (error) {
    await page
      .screenshot({
        path: `/tmp/lukes-picks-browser-e2e-${label}-bootstrap.png`,
        fullPage: true,
      })
      .catch(() => {});
    console.error(
      `[browser:${label}] bootstrap diagnostics ` +
        JSON.stringify(diagnostics, null, 2),
    );
    console.error(
      `[browser:${label}] body=${await page.locator("body").innerHTML().catch(() => "unavailable")}`,
    );
    await context.close();
    throw error;
  }
}

function assertCleanBrowserDiagnostics(users) {
  const unexpected = users.flatMap((user) => [
    ...user.diagnostics.consoleErrors.map((value) => ({
      user: user.label,
      kind: "console-error",
      ...value,
    })),
    ...user.diagnostics.pageErrors.map((value) => ({
      user: user.label,
      kind: "page-error",
      value,
    })),
    ...user.diagnostics.failedRequests.map((value) => ({
      user: user.label,
      kind: "failed-local-request",
      ...value,
    })),
    ...user.diagnostics.failedResponses.map((value) => ({
      user: user.label,
      kind: "failed-local-response",
      ...value,
    })),
  ]);
  for (const user of users) {
    if (user.diagnostics.allowedNoise.length > 0) {
      console.log(
        `[E2E] Allowed emulator/provider noise for ${user.label}: ` +
          JSON.stringify(user.diagnostics.allowedNoise),
      );
    }
  }
  assert.deepEqual(
    unexpected,
    [],
    `Unexpected browser diagnostics: ${JSON.stringify(unexpected, null, 2)}`,
  );
}

async function joinArena(user, inviteCode) {
  await button(user.page, "Enter invite code").click();
  await expectText(user.page, "Join an arena");
  await fillFlutterTextbox(user.page, "Invite code", inviteCode);
  const joinResponsePromise = callableResponse(
    user.page,
    "joinLeagueByCode",
  );
  await button(user.page, "Join arena").click();
  const joined = await parseCallable(await joinResponsePromise);
  await expectDashboard(user.page);
  return joined;
}

async function signOutSignInAndRestore(user) {
  const originalUid = user.uid;
  await navigate(user.page, "Settings", "Settings");
  await button(user.page, "Sign out").click();
  await expectText(user.page, "Welcome to the arena");

  const profileResponsePromise = callableResponse(
    user.page,
    "ensureUserProfile",
  );
  await button(user.page, /^Continue with Google/).click();
  const profileResponse = await profileResponsePromise;
  await parseCallable(profileResponse);
  const authorization = profileResponse.request().headers().authorization;
  assert.match(authorization ?? "", /^Bearer /);
  user.token = authorization.slice("Bearer ".length);
  user.uid = decodeUid(user.token);
  assert.equal(user.uid, originalUid, "Re-authentication changed the user UID.");
  await expectDashboard(user.page, PROVIDER_TIMEOUT_MS);
}

async function navigate(page, label, expectedText) {
  await enableFlutterSemantics(page);
  const path = NAVIGATION_PATHS[label];
  assert.ok(path, `Unknown navigation destination: ${label}`);
  const item = navigationItem(page, label);
  if (await item.isVisible().catch(() => false)) {
    await item.click();
  } else {
    await page.evaluate((destination) => {
      window.history.pushState(null, "", destination);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, path);
  }
  await page.waitForURL((url) => url.pathname === path, {
    timeout: ACTION_TIMEOUT_MS,
  });
  await expectText(page, expectedText);
}

async function clickPick(page, teamName) {
  // Flutter's canvas renderer exposes the surrounding InkWell as an attached
  // ARIA semantics node, but Chromium may classify that overlay as hidden even
  // while the card is visibly painted. Target the exact semantic action and
  // force only Playwright's visibility precondition; Flutter still receives
  // the real click at the node's rendered coordinates.
  const choice = page
    .locator('flt-semantics[role="button"][flt-tappable]')
    .filter({
      hasText: new RegExp(`^Pick ${escapeRegExp(teamName)}(?:\\s|$)`),
    })
    .first();
  await choice.waitFor({state: "attached"});
  const [response] = await Promise.all([
    callableResponse(page, "submitOrConfirmEntry"),
    choice.click({force: true}),
  ]);
  const result = await parseCallable(response);
  assert.ok(result.savedPickCount >= 1);
  return result;
}

async function expectLockedPick(page, teamName) {
  await enableFlutterSemantics(page);
  await waitUntil(`locked ${teamName} pick semantics`, async () => {
    const semantics = await page.locator("flt-semantics-host").innerText();
    return semantics.split("\n").some(
      (line) =>
        line.startsWith(`Pick ${teamName}`) &&
        line.toLowerCase().includes("locked"),
    );
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function documentUrl(path) {
  const encoded = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return (
    `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${encoded}`
  );
}

async function firestoreGet(path, token) {
  const response = await fetch(documentUrl(path), {
    headers: {authorization: `Bearer ${token}`},
  });
  const body = await response.text();
  return {status: response.status, body};
}

async function rawCallable(name, token, data) {
  const response = await fetch(callableUrl(name), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({data}),
  });
  const body = await response.json();
  return {status: response.status, body};
}

async function saveThreeRemoveOneAndPublish(owner, adminDb, leagueId, weekId) {
  await navigate(owner.page, "Draft slate", "Build the Week 1 slate");
  await expectText(owner.page, "Internal test · TheSportsDB", PROVIDER_TIMEOUT_MS);
  const providerConfiguration = await adminDb
    .doc("systemConfig/theSportsDbTestCatalog")
    .get();
  assert.equal(
    providerConfiguration.data()?.attribution?.text,
    "Sports data and artwork from TheSportsDB",
  );
  assert.equal(
    providerConfiguration.data()?.attribution?.url,
    "https://www.thesportsdb.com",
  );
  const include = owner.page.getByRole("checkbox", {name: /^Include /});
  await waitUntil(
    "at least three selectable catalog games",
    async () => (await include.count()) >= 3,
    PROVIDER_TIMEOUT_MS,
  );

  for (let index = 0; index < 3; index += 1) {
    await include.first().click();
    const selectedCount = index + 1;
    await expectText(
      owner.page,
      new RegExp(`${selectedCount} games? selected`),
    );
  }
  await expectText(owner.page, /3 games selected/);
  await button(owner.page, "Save draft").click();
  await expectText(owner.page, /3 games selected · Draft saved/);

  const remove = owner.page.getByRole("checkbox", {name: /^Remove /});
  await remove.first().click();
  await expectText(owner.page, /2 games selected · Not saved/);
  await button(owner.page, "Save draft").click();
  await expectText(owner.page, /2 games selected · Draft saved/);

  await waitUntil("exact two-game server draft", async () => {
    const snapshot = await adminDb
      .collection(`leagues/${leagueId}/weeks/${weekId}/games`)
      .get();
    return snapshot.size === 2;
  });

  await button(owner.page, "Review slate").click();
  await expectText(owner.page, "Review and publish");
  const publishResponsePromise = callableResponse(
    owner.page,
    "publishWeeklySlate",
  );
  await button(owner.page, "Publish 2-game slate").click();
  await expectText(owner.page, "Publish Week 1?");
  await button(owner.page, "Publish slate").click();
  const published = await parseCallable(await publishResponsePromise);
  assert.equal(published.selectedGameCount, 2);
  assert.equal(published.eligibleMemberCount, 2);
  await expectDashboard(owner.page);

  const snapshot = await adminDb
    .collection(`leagues/${leagueId}/weeks/${weekId}/games`)
    .orderBy("scheduledAtUtc")
    .get();
  assert.equal(snapshot.size, 2);
  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

async function assertPrivatePickRules({
  owner,
  memberA,
  memberB,
  leagueId,
  weekId,
  gameId,
}) {
  const path =
    `leagues/${leagueId}/weeks/${weekId}/entries/` +
    `${memberA.uid}/picks/${gameId}`;
  const [own, ownerAttempt, peerAttempt] = await Promise.all([
    firestoreGet(path, memberA.token),
    firestoreGet(path, owner.token),
    firestoreGet(path, memberB.token),
  ]);
  assert.equal(own.status, 200, `Own private pick was unreadable: ${own.body}`);
  assert.equal(
    ownerAttempt.status,
    403,
    `Owner unexpectedly read a pre-lock private pick: ${ownerAttempt.body}`,
  );
  assert.equal(
    peerAttempt.status,
    403,
    `Peer unexpectedly read a pre-lock private pick: ${peerAttempt.body}`,
  );
}

async function overrideAsVoid(owner, gameIndex, reason) {
  const overrideButtons = owner.page.getByRole("button", {
    name: "Override",
    exact: true,
  });
  await overrideButtons.nth(gameIndex).click();
  await expectText(owner.page, /^Override /);
  await fillFlutterTextbox(owner.page, "Required audit reason", reason);
  const responsePromise = callableResponse(owner.page, "overrideGameResult");
  await button(owner.page, "Save override").click();
  const result = await parseCallable(await responsePromise);
  assert.equal(typeof result.resultVersion, "string");
  await expectText(owner.page, "Override saved to the audit trail.");
}

async function run() {
  assertLocalTarget();
  const executablePath = chromeExecutable();
  console.log(`[E2E] Project: ${PROJECT_ID}`);
  console.log(`[E2E] Browser: ${executablePath}`);
  console.log(
    `[E2E] Emulators: auth=${AUTH_HOST}, firestore=${FIRESTORE_HOST}, ` +
      `functions=${FUNCTIONS_HOST}, hosting=${HOSTING_HOST}`,
  );

  const adminApp = initializeApp({projectId: PROJECT_ID}, "browser-e2e-admin");
  const adminDb = getFirestore(adminApp);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--force-renderer-accessibility",
      "--no-first-run",
    ],
  });
  let owner;
  let memberA;
  let memberB;

  try {
    [owner, memberA, memberB] = await step(
      "sign in three isolated browser users",
      async () => {
        const users = [];
        for (const label of ["owner", "member-a", "member-b"]) {
          users.push(await createBrowserUser(browser, label));
        }
        assert.equal(new Set(users.map((user) => user.uid)).size, 3);
        return users;
      },
    );

    const arena = await step("owner creates arena and Week 1", async () => {
      await button(owner.page, "Create Luke’s Picks Arena").click();
      await expectText(owner.page, "Create your arena");
      const arenaName = `Browser E2E ${Date.now()}`;
      await fillFlutterTextbox(owner.page, "Arena name", arenaName);
      const leagueResponsePromise = callableResponse(owner.page, "createLeague");
      const weekResponsePromise = callableResponse(
        owner.page,
        "createDraftWeek",
      );
      await button(owner.page, "Create arena").click();
      const [league, week] = await Promise.all([
        leagueResponsePromise.then(parseCallable),
        weekResponsePromise.then(parseCallable),
      ]);
      await expectDashboard(owner.page, PROVIDER_TIMEOUT_MS);
      assert.equal(week.pickerUid, owner.uid);
      return {...league, ...week};
    });

    await step("two members join and refresh restores membership", async () => {
      const joinedA = await joinArena(memberA, arena.inviteCode);
      const joinedB = await joinArena(memberB, arena.inviteCode);
      assert.equal(joinedA.leagueId, arena.leagueId);
      assert.equal(joinedB.leagueId, arena.leagueId);
      await signOutSignInAndRestore(memberB);
      await memberB.page.reload({waitUntil: "domcontentloaded"});
      await enableFlutterSemantics(memberB.page);
      await expectDashboard(memberB.page);
    });

    const games = await step(
      "catalog select/save/remove/save/review/publish",
      () =>
        saveThreeRemoveOneAndPublish(
          owner,
          adminDb,
          arena.leagueId,
          arena.weekId,
        ),
    );
    const [firstGame, secondGame] = games;
    assert.ok(firstGame && secondGame);

    await step("default picker exclusion and pre-lock privacy UI", async () => {
      await navigate(owner.page, "Make picks", "You’re this week’s picker.");
      await navigate(owner.page, "Results", "Weekly results");
      await expectText(
        owner.page,
        "Member choices stay private until each game locks.",
      );
    });

    await step("members make and change browser picks", async () => {
      await navigate(memberA.page, "Make picks", "Make your picks");
      await clickPick(memberA.page, firstGame.awayTeam.name);
      await clickPick(memberA.page, firstGame.homeTeam.name);
      await clickPick(memberA.page, secondGame.awayTeam.name);
      await expectText(memberA.page, "Your entry is complete");

      await navigate(memberB.page, "Make picks", "Make your picks");
      await clickPick(memberB.page, firstGame.awayTeam.name);
      await clickPick(memberB.page, secondGame.homeTeam.name);
      await expectText(memberB.page, "Your entry is complete");
    });

    await step("Firestore rules deny pre-lock cross-user reads", () =>
      assertPrivatePickRules({
        owner,
        memberA,
        memberB,
        leagueId: arena.leagueId,
        weekId: arena.weekId,
        gameId: firstGame.id,
      }),
    );

    const firstGameReference = adminDb.doc(
      `leagues/${arena.leagueId}/weeks/${arena.weekId}/games/${firstGame.id}`,
    );
    const secondGameReference = adminDb.doc(
      `leagues/${arena.leagueId}/weeks/${arena.weekId}/games/${secondGame.id}`,
    );

    await step("server lock rejects late pick while later game stays open", async () => {
      await firstGameReference.update({
        effectiveLockAtUtc: Timestamp.fromMillis(Date.now() - 60_000),
      });
      const late = await rawCallable(
        "submitOrConfirmEntry",
        memberA.token,
        {
          requestId: `late_${Date.now()}`,
          leagueId: arena.leagueId,
          weekId: arena.weekId,
          picks: [
            {
              gameId: firstGame.id,
              selectedTeamId: firstGame.awayTeam.id,
            },
          ],
        },
      );
      assert.notEqual(late.status, 200, JSON.stringify(late.body));
      assert.equal(late.body?.error?.status, "FAILED_PRECONDITION");
      assert.match(late.body?.error?.message ?? "", /already locked/i);

      await memberA.page.reload({waitUntil: "domcontentloaded"});
      await enableFlutterSemantics(memberA.page);
      await expectDashboard(memberA.page);
      await navigate(memberA.page, "Make picks", "Make your picks");
      await expectLockedPick(memberA.page, firstGame.awayTeam.name);
      await clickPick(memberA.page, secondGame.homeTeam.name);
      await expectText(memberA.page, "Your entry is complete");
      const persisted = await firstGameReference.parent.parent
        .collection(`entries/${memberA.uid}/picks`)
        .doc(firstGame.id)
        .get();
      assert.equal(persisted.data()?.selectedTeamId, firstGame.homeTeam.id);
    });

    await step("lock all games and reveal picks through commissioner UI", async () => {
      await secondGameReference.update({
        effectiveLockAtUtc: Timestamp.fromMillis(Date.now() - 60_000),
      });
      await navigate(owner.page, "Admin review", "Review and finalize Week 1");
      const revealResponsePromise = callableResponse(
        owner.page,
        "revealLockedGamePicks",
      );
      await button(owner.page, "Process locked pick reveals").click();
      const revealed = await parseCallable(await revealResponsePromise);
      assert.equal(revealed.revealedGameCount, 2);
      assert.equal(revealed.revealsByGame[firstGame.id].length, 2);
      assert.equal(revealed.revealsByGame[secondGame.id].length, 2);

      const revealPath =
        `leagues/${arena.leagueId}/weeks/${arena.weekId}/reveals/` +
        `${firstGame.id}/picks/${memberA.uid}`;
      const publicReveal = await firestoreGet(revealPath, owner.token);
      assert.equal(
        publicReveal.status,
        200,
        `Locked reveal was unreadable: ${publicReveal.body}`,
      );
      await navigate(owner.page, "Results", "Weekly results");
      await expectText(owner.page, "Commissioner review");
      const revealScreenshot = await owner.page.screenshot({
        path: "/tmp/lukes-picks-browser-e2e-reveals.png",
        fullPage: true,
      });
      assert.ok(
        revealScreenshot.byteLength > 10_000,
        "The browser reveal proof screenshot was unexpectedly empty.",
      );
    });

    await step("manual results and future picker participation via UI", async () => {
      await navigate(owner.page, "Admin review", "Review and finalize Week 1");
      await overrideAsVoid(
        owner,
        0,
        "Browser E2E verified this game as void.",
      );
      await overrideAsVoid(
        owner,
        1,
        "Browser E2E verified the second game as void.",
      );
      await expectText(owner.page, "Ready to finalize");

      await navigate(owner.page, "Settings", "Owner settings");
      const pickerSwitch = owner.page.getByRole("switch", {
        name: /Picker participates in future weeks/,
      });
      assert.equal(await pickerSwitch.getAttribute("aria-checked"), "false");
      const settingsResponsePromise = callableResponse(
        owner.page,
        "updateLeagueSettings",
      );
      await pickerSwitch.click();
      await parseCallable(await settingsResponsePromise);
      await expectText(
        owner.page,
        "Future-week picker participation saved. The current week is unchanged.",
      );
    });

    const finalized = await step(
      "finalize, score standings, and advance rotation once",
      async () => {
        await navigate(owner.page, "Admin review", "Review and finalize Week 1");
        const finalizeResponsePromise = callableResponse(
          owner.page,
          "finalizeWeek",
        );
        await button(owner.page, "Finalize Week 1").click();
        const result = await parseCallable(await finalizeResponsePromise);
        assert.equal(result.nextPickerUid, memberA.uid);
        await expectText(owner.page, "Weekly results");
        await expectText(owner.page, "Final");
        await navigate(owner.page, "Standings", "Overall standings");
        await expectText(owner.page, "Eligible weeks");

        const [weekSnapshot, leagueSnapshot, standingsSnapshot] =
          await Promise.all([
            adminDb
              .doc(`leagues/${arena.leagueId}/weeks/${arena.weekId}`)
              .get(),
            adminDb.doc(`leagues/${arena.leagueId}`).get(),
            adminDb
              .collection(`leagues/${arena.leagueId}/standings`)
              .get(),
          ]);
        assert.equal(weekSnapshot.data()?.status, "finalized");
        assert.equal(leagueSnapshot.data()?.currentPickerUid, memberA.uid);
        assert.equal(standingsSnapshot.size, 3);
        return result;
      },
    );
    assert.equal(finalized.nextPickerUid, memberA.uid);

    await step("create Week 2 with picker participation enabled", async () => {
      await navigate(owner.page, "Admin review", "Review and finalize Week 1");
      const nextWeekResponsePromise = callableResponse(
        owner.page,
        "createNextWeek",
      );
      await button(owner.page, "Create and assign next week").click();
      const nextWeek = await parseCallable(await nextWeekResponsePromise);
      assert.equal(nextWeek.pickerUid, memberA.uid);
      await expectText(owner.page, "Build the Week 2 slate", PROVIDER_TIMEOUT_MS);

      const nextWeekSnapshot = await adminDb
        .doc(`leagues/${arena.leagueId}/weeks/${nextWeek.weekId}`)
        .get();
      assert.equal(nextWeekSnapshot.data()?.status, "draft");
      assert.equal(nextWeekSnapshot.data()?.pickerUid, memberA.uid);
      assert.equal(
        nextWeekSnapshot.data()?.pickerParticipatesSnapshot,
        true,
      );

      await navigate(memberA.page, "Draft slate", "Build the Week 2 slate");
      await expectText(
        memberA.page,
        "Internal test · TheSportsDB",
        PROVIDER_TIMEOUT_MS,
      );
      const include = memberA.page.getByRole("checkbox", {name: /^Include /});
      await waitUntil(
        "a selectable Week 2 catalog game",
        async () => (await include.count()) >= 1,
        PROVIDER_TIMEOUT_MS,
      );
      await include.first().click();
      await expectText(memberA.page, /1 game selected · Not saved/);
      await button(memberA.page, "Save draft").click();
      await expectText(memberA.page, /1 game selected · Draft saved/);
      await button(memberA.page, "Review slate").click();
      await expectText(memberA.page, "Review and publish");

      const publishResponsePromise = callableResponse(
        memberA.page,
        "publishWeeklySlate",
      );
      await button(memberA.page, "Publish 1-game slate").click();
      await expectText(memberA.page, "Publish Week 2?");
      await button(memberA.page, "Publish slate").click();
      const published = await parseCallable(await publishResponsePromise);
      assert.equal(published.selectedGameCount, 1);
      assert.equal(published.eligibleMemberCount, 3);
      await expectDashboard(memberA.page);

      await navigate(memberA.page, "Make picks", "Make your picks");
      assert.equal(
        await textLocator(memberA.page, "You’re this week’s picker.")
          .isVisible()
          .catch(() => false),
        false,
        "Enabled picker was incorrectly excluded in Week 2.",
      );
      const pickResponsePromise = callableResponse(
        memberA.page,
        "submitOrConfirmEntry",
      );
      await memberA.page
        .getByRole("button", {name: /^Pick /})
        .first()
        .click();
      const savedPick = await parseCallable(await pickResponsePromise);
      assert.equal(savedPick.savedPickCount, 1);
      assert.equal(savedPick.completionState, "complete");
      await expectText(memberA.page, "Your entry is complete");

      const memberEntry = await adminDb
        .doc(
          `leagues/${arena.leagueId}/weeks/${nextWeek.weekId}/entries/` +
            memberA.uid,
        )
        .get();
      assert.equal(memberEntry.data()?.eligible, true);
      assert.equal(memberEntry.data()?.savedPickCount, 1);
    });

    await step("no unexpected browser or local-network errors", async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      assertCleanBrowserDiagnostics([owner, memberA, memberB]);
    });

    console.log(
      "\n[E2E] PASS connected browser lifecycle: 3 isolated users, " +
        "create/join/catalog/draft removal/publish/picks/privacy/lock/" +
        "late rejection/reveal/manual result/finalize/standings/rotation/" +
        "next week/picker participation.",
    );
  } catch (error) {
    const pages = [owner, memberA, memberB].filter(Boolean);
    for (const user of pages) {
      await user.page
        .screenshot({
          path: `/tmp/lukes-picks-browser-e2e-${user.label}.png`,
          fullPage: true,
        })
        .catch(() => {});
      const semanticText = await user.page
        .locator("flt-semantics-host")
        .innerText()
        .catch(() => "unavailable");
      console.error(
        `[browser:${user.label}] failure url=${user.page.url()} ` +
          `semanticText=${semanticText.slice(0, 12_000)}`,
      );
    }
    throw error;
  } finally {
    await browser.close();
    await deleteApp(adminApp);
  }
}

const fullRunTimeout = new Promise((_, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`Browser E2E exceeded ${FULL_RUN_TIMEOUT_MS} ms.`)),
    FULL_RUN_TIMEOUT_MS,
  );
  timer.unref();
});

await Promise.race([run(), fullRunTimeout]);
