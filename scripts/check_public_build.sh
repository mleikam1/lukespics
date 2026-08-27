#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

readonly build_dir="${1:-build/web}"
readonly main_bundle="$build_dir/main.dart.js"

if [[ "$#" -gt 1 ]]; then
  echo "Usage: $0 [build/web]" >&2
  exit 64
fi

if [[ -L "$build_dir" ]]; then
  echo "Public build directory must not be a symbolic link: $build_dir" >&2
  exit 1
fi

invalid_build_path=false
while IFS= read -r -d '' path; do
  if [[ -L "$path" ]]; then
    printf 'Public build contains a symbolic link: %q\n' "$path" >&2
    invalid_build_path=true
  elif [[ "$path" == *[$'\001'-$'\037'$'\177']* ]]; then
    printf 'Public build contains a control character in a path: %q\n' "$path" >&2
    invalid_build_path=true
  fi
done < <(find "$build_dir" -print0 2>/dev/null)
if [[ "$invalid_build_path" == true ]]; then
  exit 1
fi

for required_file in \
  "$build_dir/index.html" \
  "$build_dir/flutter_bootstrap.js" \
  "$main_bundle"; do
  if [[ ! -s "$required_file" ]]; then
    echo "Fresh Flutter web release is missing: $required_file" >&2
    exit 1
  fi
done

newer_sources=()
while IFS= read -r -d '' path; do
  newer_sources[${#newer_sources[@]}]="$path"
  if [[ ${#newer_sources[@]} -ge 20 ]]; then
    break
  fi
done < <(
  find lib web assets pubspec.yaml pubspec.lock \
    -type f \
    -newer "$main_bundle" \
    -print0 2>/dev/null
)
if [[ ${#newer_sources[@]} -gt 0 ]]; then
  echo "The public build is stale; source files are newer than main.dart.js:" >&2
  printf '%s\n' "${newer_sources[@]}" >&2
  exit 1
fi

scan_files() {
  find "$build_dir" -type f -print0
}

source_maps=()
while IFS= read -r -d '' path; do
  source_maps[${#source_maps[@]}]="$path"
  if [[ ${#source_maps[@]} -ge 20 ]]; then
    break
  fi
done < <(find "$build_dir" -type f -name '*.map' -print0 2>/dev/null)
if [[ ${#source_maps[@]} -gt 0 ]]; then
  echo "Public build contains source maps, which are not approved for Hosting:" >&2
  printf '%s\n' "${source_maps[@]}" >&2
  exit 1
fi

matching_files() {
  local pattern="$1"
  local file
  while IFS= read -r -d '' file; do
    if LC_ALL=C grep -aEqi -- "$pattern" "$file"; then
      printf '%q\n' "$file"
    fi
  done < <(scan_files)
}

readonly production_attestation='lukes-picks-connected-public-release-v1'
readonly non_public_attestation='lukes-picks-non-public-local-runtime-v1'

if ! LC_ALL=C grep -aFq "$production_attestation" "$main_bundle"; then
  echo "Public build is missing its connected-production attestation." >&2
  exit 1
fi

readonly forbidden_pattern='wingman-interactive-live|lukes-picks-non-public-local-runtime-v1|USE_FIREBASE_EMULATORS|ENABLE_BROWSER_E2E_AUTH|FIREBASE_(AUTH|FUNCTIONS)_EMULATOR|FIRESTORE_EMULATOR|ALLOW_(THESPORTSDB_TEST|SPORTSDATAIO|ESPN)_PROVIDER|SPORTSDATAIO_(ACCESS_MODE|ENTITLEMENT_VERIFIED|API_KEY)|Ocp-Apim-Subscription-Key|api\.sportsdata\.io|site\.api\.espn\.com|site\.web\.api\.espn\.com|(^|[^[:alnum:]_])espn([^[:alnum:]_]|$)|https?://(127\.0\.0\.1|localhost)(:[0-9]+)?|https?://[^[:space:]"'"'"']*(espn\.com|espncdn\.com|wikipedia\.org|wikimedia\.org|thesportsdb\.(com|net)|cbssports\.com|cbsimg\.net|cbsistatic\.com)'
forbidden_matches="$(matching_files "$forbidden_pattern")"
if [[ -n "$forbidden_matches" ]]; then
  echo "Public build contains a non-public attestation, server-only provider material, blocked third-party content, or forbidden project in:" >&2
  printf '%s\n' "$forbidden_matches" >&2
  exit 1
fi

readonly secret_pattern='-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|x-apisports-key[[:space:]]*[:=][[:space:]]*[^[:space:]$<{]+|Ocp-Apim-Subscription-Key[[:space:]]*[:=][[:space:]]*[^[:space:]$<{]+|(API_SPORTS_KEY|SPORTSDATAIO_API_KEY|COLLEGE_FOOTBALL_DATA_KEY|INVITE_CODE_PEPPER)[[:space:]]*=[[:space:]]*["'"'"'][^"'"'"'$<{][^"'"'"']*["'"'"']|"(private_key|client_secret)"[[:space:]]*:[[:space:]]*"[^"]+"'
secret_matches="$(matching_files "$secret_pattern")"
if [[ -n "$secret_matches" ]]; then
  echo "Public build contains potential secret material in:" >&2
  printf '%s\n' "$secret_matches" >&2
  exit 1
fi

contains_authorized_config=false
while IFS= read -r -d '' file; do
  if LC_ALL=C grep -aFq '271408880910' "$file"; then
    contains_authorized_config=true
    break
  fi
done < <(scan_files)

if [[ "$contains_authorized_config" != true ]]; then
  echo "Public build does not contain the authorized Firebase project number." >&2
  exit 1
fi

echo "Fresh public build scan passed."
