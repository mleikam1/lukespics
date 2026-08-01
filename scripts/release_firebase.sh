#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

readonly project_id="lukes-picks"
readonly preview_channel="connected-picker-flow"
readonly action="${1:-}"
readonly firebase_cli="$repo_root/functions/node_modules/.bin/firebase"
preview_stage=""

cleanup() {
  if [[ -n "$preview_stage" && -d "$preview_stage" ]]; then
    chmod -R u+w "$preview_stage" 2>/dev/null || true
    rm -rf -- "$preview_stage"
  fi
}
trap cleanup EXIT

usage() {
  cat >&2 <<'USAGE'
Usage:
  ./scripts/release_firebase.sh rules-indexes
  ./scripts/release_firebase.sh functions
  ./scripts/release_firebase.sh preview
  ./scripts/release_firebase.sh hosting-live

The live action can only clone the fixed connected-picker-flow preview to the
fixed lukes-picks:live channel. This wrapper accepts no project override.
USAGE
}

if [[ "$#" -ne 1 ]]; then
  usage
  exit 64
fi

if [[ ! -x "$firebase_cli" ]]; then
  echo "Run npm --prefix functions ci before a Firebase release." >&2
  exit 66
fi
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo "Firebase releases require the reviewed Node 22 toolchain." >&2
  exit 66
fi

./scripts/check_public_source.sh

case "$action" in
  rules-indexes)
    command=("$firebase_cli" deploy
      --only firestore:rules,firestore:indexes
      --project "$project_id"
      --non-interactive)
    ;;
  functions)
    command=("$firebase_cli" deploy
      --only functions
      --project "$project_id"
      --non-interactive)
    ;;
  preview)
    # Verify freshness against the original artifact before copying. macOS
    # otherwise gives copied files new mtimes and could make a stale build look
    # newer than its sources.
    ./scripts/check_public_build.sh build/web
    preview_stage="$(mktemp -d "${TMPDIR:-/tmp}/lukes-picks-preview.XXXXXX")"
    cp -Rp build/web "$preview_stage/web"
    # Re-scan the exact immutable bytes that Firebase Hosting will enumerate.
    ./scripts/check_public_build.sh "$preview_stage/web"
    node - "$preview_stage" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const stage = process.argv[2];
const config = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
config.hosting.public = path.join(stage, "web");
fs.writeFileSync(
  path.join(stage, "firebase.preview.json"),
  `${JSON.stringify(config, null, 2)}\n`,
  {mode: 0o600},
);
NODE
    chmod -R a-w "$preview_stage/web"
    command=("$firebase_cli" hosting:channel:deploy "$preview_channel"
      --project "$project_id"
      --config "$preview_stage/firebase.preview.json"
      --non-interactive)
    ;;
  hosting-live)
    # Live Hosting must receive the already-reviewed preview bytes rather than
    # independently enumerating a mutable build directory.
    ./scripts/check_public_build.sh build/web
    command=("$firebase_cli" hosting:clone
      "${project_id}:${preview_channel}"
      "${project_id}:live"
      --project "$project_id"
      --non-interactive)
    ;;
  *)
    echo "Unsupported release action: $action" >&2
    usage
    exit 64
    ;;
esac

printf 'Authorized release command:'
printf ' %q' "${command[@]}"
printf '\n'

# Keep the verified identity check immediately adjacent to the cloud write.
./scripts/assert_firebase_project.sh "$project_id"
"${command[@]}"
