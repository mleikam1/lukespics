#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repo_root="$(cd "$script_dir/.." && pwd)"
readonly firebase_cli="$repo_root/functions/node_modules/.bin/firebase"
readonly expected_project="lukes-picks"
readonly expected_display_name="Lukes-picks"
readonly expected_number="271408880910"

target_project="${1:-}"
if [[ -z "$target_project" || "$#" -ne 1 ]]; then
  echo "Usage: $0 <firebase-project-id>" >&2
  exit 64
fi

if [[ "$target_project" != "$expected_project" ]]; then
  echo "Refusing unexpected Firebase project: $target_project" >&2
  exit 65
fi

if [[ ! -x "$firebase_cli" ]]; then
  echo "Run npm --prefix functions ci before a Firebase safety check." >&2
  exit 66
fi
if ! command -v gcloud >/dev/null 2>&1; then
  echo "Required command is unavailable: gcloud" >&2
  exit 66
fi

active_account="$(
  gcloud auth list \
    --filter='status:ACTIVE' \
    --format='value(account)' 2>/dev/null |
    sed -n '1p'
)"
if [[ -z "$active_account" ]]; then
  echo "No active Google Cloud account." >&2
  exit 66
fi

firebase_account="$(
  "$firebase_cli" login:list 2>/dev/null |
    sed -n 's/^Logged in as[[:space:]]*//p' |
    sed -n '1p'
)"
if [[ -z "$firebase_account" ]]; then
  echo "No Firebase CLI account could be confirmed." >&2
  exit 66
fi
if [[ "$firebase_account" != "$active_account" ]]; then
  echo "Firebase CLI and Google Cloud CLI accounts do not match." >&2
  exit 66
fi

project_id="$(
  gcloud projects describe "$target_project" \
    --format='value(projectId)' 2>/dev/null
)"
project_name="$(
  gcloud projects describe "$target_project" \
    --format='value(name)' 2>/dev/null
)"
project_number="$(
  gcloud projects describe "$target_project" \
    --format='value(projectNumber)' 2>/dev/null
)"
project_state="$(
  gcloud projects describe "$target_project" \
    --format='value(lifecycleState)' 2>/dev/null
)"

if [[ "$project_id" != "$expected_project" ||
      "$project_name" != "$expected_display_name" ||
      "$project_number" != "$expected_number" ||
      "$project_state" != "ACTIVE" ]]; then
  echo "Firebase project identity check failed." >&2
  exit 67
fi

owner_binding="$(
  gcloud projects get-iam-policy "$target_project" \
    --flatten='bindings[].members' \
    --filter="bindings.role=roles/owner AND bindings.members=user:$active_account" \
    --format='value(bindings.role)' 2>/dev/null |
    sed -n '1p'
)"
if [[ "$owner_binding" != "roles/owner" ]]; then
  echo "Active account is not a confirmed project owner." >&2
  exit 68
fi

echo "Firebase safety check passed."
echo "Account: $active_account"
echo "Project: $project_id"
echo "Display name: $project_name"
echo "Project number: $project_number"
echo "Lifecycle state: $project_state"
