const arenaInviteMinimumLength = 16;
const arenaInviteMaximumLength = 64;
const _arenaInvitePattern = r'^[A-Za-z0-9_-]+$';

final RegExp _arenaInviteExpression = RegExp(_arenaInvitePattern);

/// Returns the exact case-sensitive bearer token when it matches the server
/// contract. Invalid or oversized URL values are discarded before routing.
String? normalizeArenaInviteCode(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null ||
      trimmed.length < arenaInviteMinimumLength ||
      trimmed.length > arenaInviteMaximumLength ||
      !_arenaInviteExpression.hasMatch(trimmed)) {
    return null;
  }
  return trimmed;
}

/// Reads the current fragment-based invite format and older query-based links.
///
/// The fragment keeps the bearer token out of Hosting request logs and HTTP
/// referrers. Query parsing remains only for backwards-compatible links.
String? inviteCodeFromUri(Uri uri) {
  final queryCandidate =
      uri.queryParameters['invite'] ?? uri.queryParameters['code'];
  final queryCode = normalizeArenaInviteCode(queryCandidate);
  if (queryCode != null) return queryCode;

  if (uri.fragment.isEmpty) return null;
  try {
    final fragment = Uri.splitQueryString(uri.fragment);
    return normalizeArenaInviteCode(fragment['invite'] ?? fragment['code']);
  } on FormatException {
    return null;
  }
}

Uri buildArenaInviteUri(String inviteCode) {
  final normalized = normalizeArenaInviteCode(inviteCode);
  if (normalized == null) {
    throw ArgumentError.value(inviteCode, 'inviteCode', 'Invalid invite code');
  }
  final fragment = Uri(queryParameters: {'invite': normalized}).query;
  return Uri(
    scheme: 'https',
    host: 'lukes-picks.web.app',
    path: '/arena/join',
    fragment: fragment,
  );
}

String buildArenaInviteMessage({
  required String arenaName,
  required String inviteCode,
}) {
  final normalized = normalizeArenaInviteCode(inviteCode);
  if (normalized == null) {
    throw ArgumentError.value(inviteCode, 'inviteCode', 'Invalid invite code');
  }
  final safeArenaName = arenaName.trim().isEmpty
      ? 'my arena'
      : arenaName.trim();
  final link = buildArenaInviteUri(normalized);
  return "You're invited to join $safeArenaName on Luke’s Picks. "
      'Open this private link, sign in with Google, then tap Join arena:\n'
      '$link\n\n'
      'Invite code: $normalized';
}
