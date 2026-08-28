const modernArenaInviteCodeLength = 8;
const legacyArenaInviteMinimumLength = 16;
const arenaInviteMaximumLength = 64;
const _modernArenaInvitePattern = r'^[A-Za-z0-9]{8}$';
const _legacyArenaInvitePattern = r'^[A-Za-z0-9_-]{16,64}$';

final RegExp _modernArenaInviteExpression = RegExp(_modernArenaInvitePattern);
final RegExp _legacyArenaInviteExpression = RegExp(_legacyArenaInvitePattern);

/// Canonicalizes a modern short code to uppercase while preserving the exact
/// case of compatible legacy bearer tokens. Invalid URL values are discarded.
String? normalizeArenaInviteCode(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.length > arenaInviteMaximumLength) {
    return null;
  }
  if (trimmed.length == modernArenaInviteCodeLength &&
      _modernArenaInviteExpression.hasMatch(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (trimmed.length >= legacyArenaInviteMinimumLength &&
      _legacyArenaInviteExpression.hasMatch(trimmed)) {
    return trimmed;
  }
  return null;
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
  return 'Join $safeArenaName on Luke’s Picks:\n'
      '$link\n\n'
      'Code: $normalized';
}
