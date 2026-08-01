#!/usr/bin/env bash
set -euo pipefail

readonly project_id="demo-lukes-picks-local"
readonly loopback="127.0.0.1"
readonly auth_host="${loopback}:9099"
readonly firestore_host="${loopback}:8080"
readonly functions_host="${loopback}:5001"
readonly hosting_host="${loopback}:5002"
readonly firebase_cli="functions/node_modules/.bin/firebase"
readonly android_studio_java_home="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
readonly functions_emulator_env="functions/.env.local"
readonly functions_emulator_secrets="functions/.secret.local"
readonly disabled_provider_credential="disabled-${project_id}-fixture"

if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo "Browser E2E requires Node 22." >&2
  exit 64
fi
if [[ ! -x "$firebase_cli" ]]; then
  echo "Run npm --prefix functions ci before the browser E2E." >&2
  exit 66
fi
if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter is required for the emulator web build." >&2
  exit 66
fi

if { ! command -v java >/dev/null 2>&1 ||
     ! java -version 2>&1 | sed -n '1p' | grep -Eq '"21([.]|")'; } &&
   [[ -x "$android_studio_java_home/bin/java" ]]; then
  export JAVA_HOME="$android_studio_java_home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if ! command -v java >/dev/null 2>&1 ||
   ! java -version 2>&1 | sed -n '1p' | grep -Eq '"21([.]|")'; then
  echo "Firebase emulators require Java 21 for this test." >&2
  exit 66
fi

export GCLOUD_PROJECT="$project_id"
export GOOGLE_CLOUD_PROJECT="$project_id"
export FIREBASE_PROJECT_ID="$project_id"
export FIREBASE_AUTH_EMULATOR_HOST="$auth_host"
export FIRESTORE_EMULATOR_HOST="$firestore_host"
export FUNCTIONS_EMULATOR_HOST="$functions_host"
export FIREBASE_HOSTING_EMULATOR_HOST="$hosting_host"
export ALLOW_THESPORTSDB_TEST_PROVIDER="true"
export ALLOW_API_SPORTS_PROVIDER="false"
export USE_SANITIZED_MLB_FIXTURE="true"
export INVITE_CODE_PEPPER="${project_id}-browser-e2e-invite-pepper"
unset GOOGLE_APPLICATION_CREDENTIALS

if [[ -e "$functions_emulator_env" || -e "$functions_emulator_secrets" ]]; then
  echo "Refusing to overwrite an existing local Functions environment." >&2
  exit 73
fi
cleanup_browser_e2e_env() {
  rm -f -- "$functions_emulator_env" "$functions_emulator_secrets"
}
trap cleanup_browser_e2e_env EXIT
umask 077
printf 'ALLOW_API_SPORTS_PROVIDER=false\n' > "$functions_emulator_env"
printf 'INVITE_CODE_PEPPER=%s\nAPI_SPORTS_KEY=%s\n' \
  "$INVITE_CODE_PEPPER" \
  "$disabled_provider_credential" > "$functions_emulator_secrets"

npm --prefix functions run build

flutter build web --release \
  --dart-define=LUKE_PICKS_PUBLIC_RELEASE=false \
  --dart-define=USE_FIREBASE_EMULATORS=true \
  --dart-define=ENABLE_BROWSER_E2E_AUTH=true \
  --dart-define=FIREBASE_PROJECT_ID="$project_id" \
  --dart-define=FIREBASE_EMULATOR_HOST="$loopback" \
  --dart-define=FIREBASE_AUTH_EMULATOR_PORT=9099 \
  --dart-define=FIRESTORE_EMULATOR_PORT=8080 \
  --dart-define=FIREBASE_FUNCTIONS_EMULATOR_PORT=5001

readonly browser_test_command='npm --prefix functions run seed && npm --prefix functions run test:browser'
"$firebase_cli" emulators:exec \
  --project "$project_id" \
  --only auth,firestore,functions,hosting \
  "$browser_test_command"
