// Provider access does not grant rights to publish third-party marks. Keep
// known unlicensed broadcaster/CDN roots blocked even when an Admin-owned
// catalog attempts to allow a more specific subdomain.
const BLOCKED_UNLICENSED_LOGO_ROOTS = [
  "espn.com",
  "espncdn.com",
  "wikipedia.org",
  "wikimedia.org",
] as const;

function normalizedHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function isBlockedUnlicensedLogoHost(hostname: string): boolean {
  const candidate = normalizedHostname(hostname);
  return BLOCKED_UNLICENSED_LOGO_ROOTS.some(
    (root) => candidate === root || candidate.endsWith(`.${root}`),
  );
}
