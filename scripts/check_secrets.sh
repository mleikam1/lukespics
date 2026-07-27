#!/usr/bin/env bash
set -euo pipefail

tracked_files="$(git ls-files)"

blocked_names="$(
  printf '%s\n' "$tracked_files" |
    grep -E '(^|/)(service-account.*\.json|GoogleService-Info\.plist|.*\.jks|.*\.keystore|.*\.p12|.*\.pem|\.env)$' ||
    true
)"

if [[ -n "$blocked_names" ]]; then
  echo "Potential credential files are tracked:"
  printf '%s\n' "$blocked_names"
  exit 1
fi

if git grep -I -n -E -- \
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|x-apisports-key[[:space:]]*[:=][[:space:]]*[^[:space:]$<{]+' \
  -- ':!scripts/check_secrets.sh'; then
  echo "Potential secret material detected."
  exit 1
fi

echo "No blocked credential files or high-confidence secret patterns found."
