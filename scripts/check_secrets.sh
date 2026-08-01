#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

candidate_files="$(
  git ls-files --cached --others --exclude-standard
)"

blocked_names="$(
  printf '%s\n' "$candidate_files" |
    grep -E '(^|/)(service-account.*\.json|.*firebase-adminsdk.*\.json|GoogleService-Info\.plist|.*\.jks|.*\.keystore|.*\.p8|.*\.p12|.*\.pem|.*\.key|\.env)$' ||
    true
)"

if [[ -n "$blocked_names" ]]; then
  echo "Potential credential files are tracked:"
  printf '%s\n' "$blocked_names"
  exit 1
fi

readonly structural_secret_pattern='-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|x-apisports-key[[:space:]]*[:=][[:space:]]*[^[:space:]$<{]+|Ocp-Apim-Subscription-Key[[:space:]]*[:=][[:space:]]*[^[:space:]$<{]+|api\.sportsdata\.io[^[:space:]"'"'"']*[?&]key=[^[:space:]$<{&]+|"(private_key|client_secret)"[[:space:]]*:[[:space:]]*"[^"]+"'
readonly named_secret_pattern="(API_SPORTS_KEY|SPORTSDATAIO_API_KEY|COLLEGE_FOOTBALL_DATA_KEY|INVITE_CODE_PEPPER)[[:space:]]*=[[:space:]]*['\"][^'\"\\$<{[:space:]][^'\"]*['\"]"

secret_files="$(
  while IFS= read -r file; do
    if [[ "$file" == "scripts/check_secrets.sh" ||
          "$file" == "scripts/check_public_build.sh" ]]; then
      continue
    fi
    if [[ -f "$file" ]] &&
       LC_ALL=C grep -IEql -- \
         "$structural_secret_pattern|$named_secret_pattern" "$file"; then
      printf '%s\n' "$file"
    fi
  done <<<"$candidate_files"
)"

if [[ -n "$secret_files" ]]; then
  echo "Potential secret material detected in:"
  printf '%s\n' "$secret_files"
  exit 1
fi

echo "No blocked credential files or high-confidence secret patterns found."
