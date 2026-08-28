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
    process.env.USE_SANITIZED_MLB_FIXTURE,
    "true",
    "The sanitized MLB fixture must be explicitly enabled.",
  );
  assert.equal(
    process.env.ALLOW_API_SPORTS_PROVIDER,
    "false",
    "The browser fixture must keep the production provider disabled.",
  );
  assert.equal(
    process.env.ALLOW_SPORTSDATAIO_PROVIDER,
    "false",
    "The browser fixture must keep SportsDataIO disabled.",
  );
  assert.equal(
    process.env.SPORTSDATAIO_ACCESS_MODE,
    "fixture",
    "The browser fixture must not select production provider access.",
  );
  assert.equal(
    process.env.SPORTSDATAIO_ENTITLEMENT_VERIFIED,
    "false",
    "The browser fixture must not claim a production entitlement.",
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

async function captureProof(page, name) {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.waitForTimeout(500);
  const screenshot = await page.screenshot({
    path: `/tmp/lukes-picks-browser-e2e-${name}.png`,
    fullPage: false,
  });
  assert.ok(
    screenshot.byteLength > 10_000,
    `The ${name} browser proof screenshot was unexpectedly empty.`,
  );
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

async function joinArenaFromLink(user, inviteCode) {
  await user.page.goto(
    `${BASE_URL}/arena/join#invite=${encodeURIComponent(inviteCode)}`,
    {waitUntil: "domcontentloaded"},
  );
  await enableFlutterSemantics(user.page);
  await expectText(user.page, "Join an arena");
  const inviteField = textbox(user.page, "Invite code");
  // An unfocused Flutter semantics textbox can expose an empty proxy value
  // even while the framework-rendered field visibly contains controller text.
  // Activate the editable DOM element before asserting the deep-link prefill.
  await inviteField.click();
  await user.page.waitForTimeout(200);
  assert.equal(
    await inviteField.inputValue(),
    inviteCode,
    "The invite link did not prefill the exact case-sensitive code.",
  );
  const joinResponsePromise = callableResponse(
    user.page,
    "joinLeagueByCode",
  );
  await button(user.page, "Join arena").click();
  const joined = await parseCallable(await joinResponsePromise);
  await expectDashboard(user.page);
  assert.equal(
    new URL(user.page.url()).hash,
    "",
    "The successful join did not scrub the invite fragment.",
  );
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
  const responsePromise = callableResponse(page, "submitOrConfirmEntry");
  try {
    await choice.click({force: true});
  } catch (error) {
    // CanvasKit can briefly report stale semantics geometry after route
    // animation, even though the rendered choice is visibly in the viewport.
    // Dispatch the same DOM click action through the attached semantics node
    // when Playwright rejects only that transient coordinate calculation.
    if (!String(error).includes("Element is outside of the viewport")) {
      throw error;
    }
    await choice.evaluate((element) => (element as HTMLElement).click());
  }
  const response = await responsePromise;
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

function catalogFilter(page, label) {
  return page
    .getByRole("checkbox", {name: label, exact: true})
    .or(page.getByRole("radio", {name: label, exact: true}))
    .or(page.getByRole("button", {name: label, exact: true}))
    .or(page.getByText(label, {exact: true}))
    .first();
}

async function selectCatalogFilter(page, label) {
  const filter = catalogFilter(page, label);
  await filter.waitFor({state: "attached", timeout: PROVIDER_TIMEOUT_MS});
  const responsePromise = callableResponse(
    page,
    "listSportsCatalog",
    PROVIDER_TIMEOUT_MS,
  );
  await filter.click({force: true});
  const result = await parseCallable(await responsePromise);
  await expectText(page, label, PROVIDER_TIMEOUT_MS);
  return result;
}

function catalogGameToggle(page, action, game) {
  return page.getByLabel(
    `${action} ${game.awayTeam.name} at ${game.homeTeam.name}`,
    {exact: true},
  ).first();
}

async function buildCrossQueryDraftAndPublishOne(
  owner,
  adminDb,
  leagueId,
  weekId,
) {
  await navigate(owner.page, "Draft slate", "Build the Week 1 slate");
  await expectText(
    owner.page,
    "Emulator fixture schedule",
    PROVIDER_TIMEOUT_MS,
  );

  const configuredLeague = await adminDb.doc(`leagues/${leagueId}`).get();
  assert.equal(configuredLeague.data()?.settings?.providerName, "mock");
  assert.deepEqual(configuredLeague.data()?.settings?.enabledSports, [
    "baseball",
  ]);
  assert.deepEqual(configuredLeague.data()?.settings?.enabledLeagues, ["mlb"]);

  const baseball = await selectCatalogFilter(owner.page, "Baseball");
  assert.equal(baseball.effectiveQuery?.sportCode, "baseball");
  assert.ok(
    baseball.sports?.some(
      (sport) => sport.code === "baseball" && sport.displayName === "Baseball",
    ),
    "The catalog did not advertise the configured Baseball sport.",
  );

  const mlb = await selectCatalogFilter(owner.page, "MLB");
  assert.equal(mlb.effectiveQuery?.sportCode, "baseball");
  assert.equal(mlb.effectiveQuery?.leagueCode, "mlb");
  assert.equal(mlb.effectiveQuery?.providerLeagueId, "synthetic-mlb-fixture");
  assert.ok(
    mlb.leagues?.some(
      (league) =>
        league.code === "mlb" &&
        league.displayName === "MLB" &&
        league.sportCode === "baseball",
    ),
    "The catalog did not advertise the configured MLB league.",
  );

  const tomorrow = await selectCatalogFilter(owner.page, "Tomorrow");
  assert.equal(tomorrow.effectiveQuery?.sportCode, "baseball");
  assert.equal(tomorrow.effectiveQuery?.leagueCode, "mlb");
  assert.equal(tomorrow.effectiveQuery?.dateMode, "tomorrow");
  assert.ok(
    tomorrow.games?.length >= 2,
    "The sanitized Tomorrow fixture did not return two MLB games.",
  );
  const tomorrowSelections = tomorrow.games.slice(0, 2);

  for (const game of tomorrowSelections) {
    const include = catalogGameToggle(owner.page, "Include", game);
    await include.waitFor({state: "attached", timeout: PROVIDER_TIMEOUT_MS});
    await include.click({force: true});
  }
  await expectText(
    owner.page,
    /2 games selected.*2 unsaved changes/,
  );
  await captureProof(owner.page, "catalog-selection");

  const later = await selectCatalogFilter(owner.page, "Later");
  assert.equal(later.effectiveQuery?.sportCode, "baseball");
  assert.equal(later.effectiveQuery?.leagueCode, "mlb");
  assert.equal(later.effectiveQuery?.dateMode, "later");
  assert.ok(
    later.games?.length >= 1,
    "The sanitized Later fixture did not return an MLB game.",
  );
  const laterSelection = later.games[0];
  const includeLater = catalogGameToggle(
    owner.page,
    "Include",
    laterSelection,
  );
  await includeLater.waitFor({state: "attached", timeout: PROVIDER_TIMEOUT_MS});
  await includeLater.click({force: true});
  await expectText(
    owner.page,
    /3 games selected.*3 unsaved changes/,
  );

  const tomorrowAgain = await selectCatalogFilter(owner.page, "Tomorrow");
  assert.equal(tomorrowAgain.effectiveQuery?.dateMode, "tomorrow");
  const retainedTomorrowToggles = tomorrowSelections.map((game) =>
    catalogGameToggle(owner.page, "Remove", game),
  );
  for (const retained of retainedTomorrowToggles) {
    await retained.waitFor({state: "attached", timeout: PROVIDER_TIMEOUT_MS});
  }
  assert.match(
    await owner.page.locator("flt-semantics-host").innerText(),
    /3 games selected.*3 unsaved changes/s,
    "Cross-query selections were not retained after returning to Tomorrow.",
  );
  await retainedTomorrowToggles[0].click({force: true});
  await expectText(
    owner.page,
    /2 games selected.*2 unsaved changes/,
  );
  const saveDraftResponsePromise = callableResponse(
    owner.page,
    "saveDraftSlate",
  );
  await button(owner.page, "Save draft").click();
  const savedDraft = await parseCallable(await saveDraftResponsePromise);
  assert.equal(savedDraft.selectedGameCount, 2);
  await expectText(owner.page, /2 games selected.*Draft saved/);

  await waitUntil("exact two-game server draft", async () => {
    const snapshot = await adminDb
      .collection(`leagues/${leagueId}/weeks/${weekId}/games`)
      .get();
    return snapshot.size === 2;
  });

  await owner.page.reload({waitUntil: "domcontentloaded"});
  await enableFlutterSemantics(owner.page);
  await expectDashboard(owner.page, PROVIDER_TIMEOUT_MS);
  await navigate(owner.page, "Draft slate", "Build the Week 1 slate");
  await expectText(
    owner.page,
    "Emulator fixture schedule",
    PROVIDER_TIMEOUT_MS,
  );
  await expectText(owner.page, /2 games selected.*Draft saved/);

  await button(owner.page, "Review slate").click();
  await expectText(owner.page, "Review and publish");
  const reviewRemovals = owner.page.getByRole("button", {name: /^Remove /});
  await waitUntil(
    "two removable review games",
    async () => (await reviewRemovals.count()) === 2,
  );
  await reviewRemovals.first().click();
  await expectText(owner.page, "1 selected");
  await captureProof(owner.page, "slate-review");

  const publishResponsePromise = callableResponse(
    owner.page,
    "publishWeeklySlate",
  );
  await button(owner.page, "Publish 1-game slate").click();
  await expectText(owner.page, "Publish Week 1?");
  await button(owner.page, "Publish slate").click();
  const published = await parseCallable(await publishResponsePromise);
  assert.equal(published.selectedGameCount, 1);
  assert.equal(published.eligibleMemberCount, 2);
  await expectDashboard(owner.page);

  const publishedWeek = await adminDb
    .doc(`leagues/${leagueId}/weeks/${weekId}`)
    .get();
  assert.equal(publishedWeek.data()?.catalogProviderSnapshot, "mock");
  assert.deepEqual(publishedWeek.data()?.catalogPresentationSnapshot, {
    provider: "mock",
    attributionText: null,
    allowRemoteLogos: false,
    allowedLogoHosts: [],
    allowedLogoQueryParameters: [],
    logoRightsReviewDate: null,
  });

  const snapshot = await adminDb
    .collection(`leagues/${leagueId}/weeks/${weekId}/games`)
    .orderBy("scheduledAtUtc")
    .get();
  assert.equal(snapshot.size, 1);
  const publishedGame = {
    id: snapshot.docs[0].id,
    ...snapshot.docs[0].data(),
  };
  assert.equal(publishedGame.provider, "mock");
  assert.equal(publishedGame.sportCode, "baseball");
  assert.equal(publishedGame.leagueCode, "mlb");
  assert.equal(publishedGame.providerLeagueId, "synthetic-mlb-fixture");
  assert.match(publishedGame.venueName, /^Sanitized Ballpark /);
  return publishedGame;
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
  const gameState = owner.page
    .getByRole("button", {name: /Game state.*Scheduled/})
    .or(owner.page.getByLabel("Game state", {exact: false}))
    .or(owner.page.getByText("Scheduled", {exact: true}))
    .first();
  await gameState.click({force: true});
  // Flutter's popup route is not exposed as stable DOM text in headless
  // Chrome. Normalize to the first item before moving to the fifth one so
  // this remains deterministic even when the game's current state changes.
  await owner.page.keyboard.press("Home");
  await owner.page.waitForTimeout(150);
  for (let option = 0; option < 4; option += 1) {
    await owner.page.keyboard.press("ArrowDown");
    await owner.page.waitForTimeout(150);
  }
  await owner.page.keyboard.press("Enter");
  await expectText(owner.page, "Void / canceled");
  await fillFlutterTextbox(owner.page, "Required audit reason", reason);
  await owner.page
    .getByRole("checkbox", {name: /I confirm this correction/})
    .click({force: true});
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

      const leagueReference = adminDb.doc(`leagues/${league.leagueId}`);
      const beforeFixtureConfiguration = await leagueReference.get();
      const beforeSettings = beforeFixtureConfiguration.data()?.settings ?? {};
      // Only the three catalog fields are merged into the emulator arena;
      // ownership, picker, lock, scoring, and finalization settings stay as
      // created by the real callable lifecycle.
      await leagueReference.update({
        "settings.providerName": "mock",
        "settings.enabledSports": ["baseball"],
        "settings.enabledLeagues": ["mlb"],
      });
      const afterFixtureConfiguration = await leagueReference.get();
      const afterSettings = afterFixtureConfiguration.data()?.settings ?? {};
      for (const [key, value] of Object.entries(beforeSettings)) {
        if (["providerName", "enabledSports", "enabledLeagues"].includes(key)) {
          continue;
        }
        assert.deepEqual(
          afterSettings[key],
          value,
          `Fixture configuration unexpectedly changed settings.${key}.`,
        );
      }
      assert.equal(afterSettings.providerName, "mock");
      assert.deepEqual(afterSettings.enabledSports, ["baseball"]);
      assert.deepEqual(afterSettings.enabledLeagues, ["mlb"]);

      await owner.page.reload({waitUntil: "domcontentloaded"});
      await enableFlutterSemantics(owner.page);
      await expectDashboard(owner.page, PROVIDER_TIMEOUT_MS);
      return {...league, ...week};
    });

    const modernInvite = await step(
      "owner creates a private invitation link",
      async () => {
        await navigate(owner.page, "Members", "Members and rotation");
        const issueResponsePromise = callableResponse(
          owner.page,
          "issueArenaInvite",
        );
        await button(owner.page, "Create invite").click();
        const issued = await parseCallable(await issueResponsePromise);
        assert.match(issued.inviteCode, /^[A-Za-z0-9_-]{24}$/);
        assert.equal(issued.maxUses, 50);
        await expectText(owner.page, "Text or share invite");
        return issued;
      },
    );

    await step("two members join and refresh restores membership", async () => {
      const joinedA = await joinArenaFromLink(
        memberA,
        modernInvite.inviteCode,
      );
      const joinedB = await joinArena(memberB, modernInvite.inviteCode);
      assert.equal(joinedA.leagueId, arena.leagueId);
      assert.equal(joinedB.leagueId, arena.leagueId);
      await signOutSignInAndRestore(memberB);
      await memberB.page.reload({waitUntil: "domcontentloaded"});
      await enableFlutterSemantics(memberB.page);
      await expectDashboard(memberB.page);
    });

    const game = await step(
      "cross-query MLB draft retention, reload, review removal, and publish",
      () =>
        buildCrossQueryDraftAndPublishOne(
          owner,
          adminDb,
          arena.leagueId,
          arena.weekId,
        ),
    );
    assert.ok(game);

    await step("default picker exclusion and pre-lock privacy UI", async () => {
      await navigate(owner.page, "Make picks", "You’re this week’s picker.");
      await navigate(owner.page, "Results", "Weekly results");
      await expectText(
        owner.page,
        "Member choices stay private until each game locks.",
      );
    });

    await step("eligible members see exactly one game and make picks", async () => {
      await navigate(memberA.page, "Make picks", "Make your picks");
      await expectText(memberA.page, /0 of 1 picks confirmed/);
      assert.equal(
        await memberA.page.getByRole("button", {name: /^Pick /}).count(),
        2,
        "Member A did not see exactly one two-team game.",
      );
      await clickPick(memberA.page, game.homeTeam.name);
      await expectText(memberA.page, "Your picks are saved and locked");
      await expectLockedPick(memberA.page, game.homeTeam.name);
      await expectLockedPick(memberA.page, game.awayTeam.name);
      await captureProof(memberA.page, "player-picks");

      await navigate(memberB.page, "Make picks", "Make your picks");
      await expectText(memberB.page, /0 of 1 picks confirmed/);
      assert.equal(
        await memberB.page.getByRole("button", {name: /^Pick /}).count(),
        2,
        "Member B did not see exactly one two-team game.",
      );
      await clickPick(memberB.page, game.awayTeam.name);
      await expectText(memberB.page, "Your picks are saved and locked");
      await expectLockedPick(memberB.page, game.awayTeam.name);
      await expectLockedPick(memberB.page, game.homeTeam.name);
    });

    await step("Firestore rules deny pre-lock cross-user reads", () =>
      assertPrivatePickRules({
        owner,
        memberA,
        memberB,
        leagueId: arena.leagueId,
        weekId: arena.weekId,
        gameId: game.id,
      }),
    );

    const gameReference = adminDb.doc(
      `leagues/${arena.leagueId}/weeks/${arena.weekId}/games/${game.id}`,
    );

    await step("completed entry rejects changes and survives reload", async () => {
      const sealedChange = await rawCallable(
        "submitOrConfirmEntry",
        memberA.token,
        {
          requestId: `late_${Date.now()}`,
          leagueId: arena.leagueId,
          weekId: arena.weekId,
          picks: [
            {
              gameId: game.id,
              selectedTeamId: game.awayTeam.id,
            },
          ],
        },
      );
      assert.notEqual(
        sealedChange.status,
        200,
        JSON.stringify(sealedChange.body),
      );
      assert.equal(
        sealedChange.body?.error?.status,
        "FAILED_PRECONDITION",
      );
      assert.match(
        sealedChange.body?.error?.message ?? "",
        /already been submitted|cannot be changed/i,
      );

      await memberA.page.reload({waitUntil: "domcontentloaded"});
      await enableFlutterSemantics(memberA.page);
      await expectDashboard(memberA.page);
      await navigate(memberA.page, "Make picks", "Make your picks");
      await expectLockedPick(memberA.page, game.homeTeam.name);
      await expectText(memberA.page, "Your picks are saved and locked");
      await captureProof(memberA.page, "locked-pick");
      const persisted = await gameReference.parent.parent
        .collection(`entries/${memberA.uid}/picks`)
        .doc(game.id)
        .get();
      assert.equal(persisted.data()?.selectedTeamId, game.homeTeam.id);
    });

    await step("reveal the locked picks through commissioner UI", async () => {
      await gameReference.update({
        effectiveLockAtUtc: Timestamp.fromMillis(Date.now() - 60_000),
      });
      await navigate(owner.page, "Admin review", "Review and finalize Week 1");
      const revealResponsePromise = callableResponse(
        owner.page,
        "revealLockedGamePicks",
      );
      await button(owner.page, "Process locked pick reveals").click();
      const revealed = await parseCallable(await revealResponsePromise);
      assert.equal(revealed.revealedGameCount, 1);
      assert.equal(revealed.revealsByGame[game.id].length, 2);

      const revealPath =
        `leagues/${arena.leagueId}/weeks/${arena.weekId}/reveals/` +
        `${game.id}/picks/${memberA.uid}`;
      const publicReveal = await firestoreGet(revealPath, owner.token);
      assert.equal(
        publicReveal.status,
        200,
        `Locked reveal was unreadable: ${publicReveal.body}`,
      );
      await navigate(owner.page, "Results", "Weekly results");
      await expectText(owner.page, "Commissioner review");
      await captureProof(owner.page, "reveals");
    });

    await step("manual results and future picker participation via UI", async () => {
      await navigate(owner.page, "Admin review", "Review and finalize Week 1");
      await overrideAsVoid(
        owner,
        0,
        "Browser E2E verified this game as void.",
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
        await captureProof(owner.page, "final-results");
        await navigate(owner.page, "Standings", "Overall standings");
        await expectText(owner.page, "Eligible weeks");
        await captureProof(owner.page, "standings");

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
        "Emulator fixture schedule",
        PROVIDER_TIMEOUT_MS,
      );
      const include = memberA.page.getByRole("checkbox", {name: /^Include /});
      await waitUntil(
        "a selectable Week 2 catalog game",
        async () => (await include.count()) >= 1,
        PROVIDER_TIMEOUT_MS,
      );
      await include.first().click();
      await expectText(memberA.page, /1 game selected.*1 unsaved change/);
      const saveDraftResponsePromise = callableResponse(
        memberA.page,
        "saveDraftSlate",
      );
      await button(memberA.page, "Save draft").click();
      const savedDraft = await parseCallable(await saveDraftResponsePromise);
      assert.equal(savedDraft.selectedGameCount, 1);
      await expectText(memberA.page, /1 game selected.*Draft saved/);
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
      await expectText(memberA.page, "Your picks are saved and locked");

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
        "create/invite-link/join/MLB filters/cross-query draft retention/" +
        "reload/review " +
        "removal/single-game publish/picks/privacy/lock/late rejection/" +
        "reveal/manual result/finalize/standings/rotation/next week/" +
        "picker participation.",
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
