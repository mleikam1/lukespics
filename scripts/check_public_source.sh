#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

readonly expected_project="lukes-picks"
readonly expected_number="271408880910"
readonly expected_emulator="demo-lukes-picks-local"
readonly options_file="lib/firebase_options.dart"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to validate Firebase JSON configuration." >&2
  exit 1
fi

for required_file in \
  ".firebaserc" \
  "firebase.json" \
  "$options_file" \
  "lib/app/bootstrap.dart" \
  "lib/app/build_profile.dart" \
  "web/index.html"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Required production source file is missing: $required_file" >&2
    exit 1
  fi
done

./scripts/check_secrets.sh

node - <<'NODE'
const fs = require("node:fs");

const aliases = JSON.parse(fs.readFileSync(".firebaserc", "utf8")).projects;
const expected = {
  default: "demo-lukes-picks-local",
  prod: "lukes-picks",
};
if (
  JSON.stringify(Object.keys(aliases).sort()) !==
    JSON.stringify(Object.keys(expected).sort()) ||
  aliases.default !== expected.default ||
  aliases.prod !== expected.prod
) {
  throw new Error(
    "Firebase aliases must be exactly default->demo-lukes-picks-local and prod->lukes-picks.",
  );
}

const firebase = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
const configured =
  firebase.flutter?.platforms?.dart?.["lib/firebase_options.dart"];
if (configured?.projectId !== "lukes-picks") {
  throw new Error("firebase.json Flutter configuration is not pinned to lukes-picks.");
}
for (const appId of Object.values(configured.configurations ?? {})) {
  if (!String(appId).startsWith("1:271408880910:")) {
    throw new Error("A Flutter Firebase app ID has an unexpected project number.");
  }
}
NODE

configured_projects="$(
  sed -n "s/.*projectId: '\\([^']*\\)'.*/\\1/p" "$options_file" |
    sort -u
)"
if [[ "$configured_projects" != "$expected_project" ]]; then
  echo "FirebaseOptions contains an unexpected project ID." >&2
  exit 1
fi

if ! grep -Fq "$expected_number" "$options_file"; then
  echo "FirebaseOptions does not contain the authorized project number." >&2
  exit 1
fi

if ! grep -Fq "options.projectId != '$expected_project'" \
  lib/app/bootstrap.dart; then
  echo "Production bootstrap does not visibly enforce the authorized project." >&2
  exit 1
fi

if ! grep -Fq "projectId != '$expected_emulator'" \
  lib/app/bootstrap.dart; then
  echo "Emulator bootstrap does not visibly enforce the isolated project." >&2
  exit 1
fi

if ! grep -Fq "defaultValue: true" lib/app/build_profile.dart ||
   ! grep -Fq "kReleaseMode &&" lib/app/build_profile.dart ||
   ! grep -Fq "!enableBrowserE2eAuth" lib/app/build_profile.dart ||
   ! grep -Fq "requestedPublicRelease && !isConnectedPublicRelease" \
     lib/app/bootstrap.dart; then
  echo "Public-release runtime attestation is not fail-closed." >&2
  exit 1
fi

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const sportsDataIoClient = path.resolve(
  "functions/src/providers/sportsDataIoClient.ts",
);
const licensingPolicy = path.resolve("functions/src/providers/licensing.ts");
const configSource = path.resolve("functions/src/config.ts");
const functionManifest = path.resolve("functions/src/index.ts");
const sportsDataIoSecretFiles = new Set([configSource, functionManifest]);
const blockedLogoRoots = new Set([
  "espn.com",
  "espncdn.com",
  "wikipedia.org",
  "wikimedia.org",
]);
const runtimeRoots = [
  path.resolve("lib"),
  path.resolve("web"),
  path.resolve("functions/src"),
];
const files = [];

function visit(candidate) {
  const stat = fs.statSync(candidate);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(candidate)) {
      visit(path.join(candidate, entry));
    }
    return;
  }
  if (stat.isFile()) files.push(candidate);
}

for (const root of runtimeRoots) visit(root);

const violations = [];
const sportsDataIoHostToken =
  /[A-Za-z0-9.-]*sportsdata\.io[A-Za-z0-9.-]*/gi;
const blockedLogoHostToken =
  /[A-Za-z0-9.-]*(?:espn\.com|espncdn\.com|wikipedia\.org|wikimedia\.org)[A-Za-z0-9.-]*/gi;
function isExactQuotedLiteral(source, hostIndex, host, expectedValue) {
  const hostOffset = expectedValue.indexOf(host);
  const literalStart = hostIndex - hostOffset - 1;
  if (literalStart < 0) return false;
  return ["\"", "'", "`"].some((quote) =>
    source.slice(literalStart, literalStart + expectedValue.length + 2) ===
      `${quote}${expectedValue}${quote}`,
  );
}

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(process.cwd(), file);
  if (source.includes("wingman-interactive-live")) {
    violations.push(`${relative}: forbidden project`);
  }

  for (const match of source.matchAll(sportsDataIoHostToken)) {
    const host = match[0].toLowerCase();
    if (file !== sportsDataIoClient || host !== "api.sportsdata.io") {
      violations.push(
        `${relative}: unapproved SportsDataIO runtime host`,
      );
    }
  }

  for (const match of source.matchAll(blockedLogoHostToken)) {
    const host = match[0].toLowerCase();
    const isBlockedRootLiteral =
      match.index !== undefined &&
      blockedLogoRoots.has(host) &&
      isExactQuotedLiteral(source, match.index, host, host);
    if (file !== licensingPolicy || !isBlockedRootLiteral) {
      violations.push(`${relative}: unapproved third-party logo host`);
    }
  }

  if (
    source.includes("SPORTSDATAIO_API_KEY") &&
    !sportsDataIoSecretFiles.has(file)
  ) {
    violations.push(`${relative}: SportsDataIO secret name outside manifest`);
  }
  if (
    source.includes("Ocp-Apim-Subscription-Key") &&
    file !== sportsDataIoClient
  ) {
    violations.push(`${relative}: provider credential header outside client`);
  }
  if (/Wikipedia(?:Logo|WordMark)Url/i.test(source)) {
    violations.push(`${relative}: unlicensed provider artwork field consumed`);
  }
  if (
    file === sportsDataIoClient &&
    (/searchParams\.(?:set|append)\(\s*["']key["']/i.test(source) ||
      /[?&]key=/i.test(source))
  ) {
    violations.push(`${relative}: provider credential placed in a URL`);
  }
  if (
    /ALLOW_ESPN_PROVIDER|site\.api\.espn\.com|site\.web\.api\.espn\.com|from\s+["'][^"']*\/espn\.js["']/i.test(
      source,
    )
  ) {
    violations.push(`${relative}: retired provider integration remains active`);
  }
}

if (fs.existsSync(path.resolve("functions/src/providers/espn.ts"))) {
  violations.push("functions/src/providers/espn.ts: retired adapter still exists");
}

if (violations.length > 0) {
  throw new Error(`Runtime source policy failed:\n${violations.join("\n")}`);
}
NODE

if grep -Eqi \
  'firebase(-app)?\.(initializeApp|initialize_app)|initializeApp[[:space:]]*\(' \
  web/index.html; then
  echo "web/index.html must not contain a second Firebase initialization." >&2
  exit 1
fi

echo "Public source configuration scan passed."
