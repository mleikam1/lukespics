import '../models/game.dart';
import '../models/member.dart';
import '../models/pick.dart';
import '../models/sports_catalog.dart';
import '../models/standing.dart';

export '../models/sports_catalog.dart';

const sportsDataIoApiKeyConfigurationReason =
    'sportsdataio-api-key-not-configured';
const sportsDataIoCredentialsConfigurationReason =
    'sportsdataio-credentials-rejected';
const sportsDataIoEntitlementConfigurationReason =
    'sportsdataio-feed-not-entitled';
const sportsDataIoConfigurationReasons = <String>{
  sportsDataIoApiKeyConfigurationReason,
  sportsDataIoCredentialsConfigurationReason,
  sportsDataIoEntitlementConfigurationReason,
};

abstract interface class LeagueRepository {
  Future<String> ensureUserProfile({String? displayName, Uri? photoUrl});

  /// Returns every active arena membership for the authenticated user.
  ///
  /// This is used to restore arena context after a browser refresh without
  /// persisting invite codes or exposing a public league directory.
  Future<List<String>> findActiveLeagueIds();

  /// Reads the arena from the server so session restoration never mistakes an
  /// empty local cache for a deleted arena.
  Future<LeagueSummary?> getLeague(String leagueId);

  /// Reads the current week from the server during session restoration.
  Future<WeekSummary?> getWeek(String leagueId, String weekId);

  /// Reads the current arena membership roster from the server during session
  /// restoration.
  Future<List<LeagueMember>> getMembers(String leagueId);

  Future<CreatedLeague> createLeague({
    required String name,
    required String timezone,
    required Map<String, Object?> settings,
  });

  Future<String> joinLeagueByCode({
    required String inviteCode,
    String? nickname,
  });

  Future<String> rotateInviteCode({required String leagueId});

  Future<ArenaInvite> issueArenaInvite({
    required String leagueId,
    String? requestId,
  });

  Future<void> revokeArenaInvite({
    required String leagueId,
    required String inviteId,
    String? requestId,
  });

  Future<void> updateLeagueSettings({
    required String leagueId,
    required Map<String, Object?> settings,
  });

  Future<void> updateMember({
    required String leagueId,
    required String memberUid,
    LeagueRole? role,
    MemberStatus? status,
  });

  Future<void> reorderPickerRotation({
    required String leagueId,
    required List<String> orderedMemberUids,
  });

  Future<void> leaveLeague(String leagueId);

  Future<int> rebuildStandings(String leagueId);

  Future<void> deleteOrAnonymizeAccount();

  Future<CreatedWeek> createDraftWeek({
    required String leagueId,
    required int sequentialNumber,
    required String label,
    required DateTime startAt,
    required DateTime endAt,
    String? pickerUid,
  });

  Future<SportsCatalogResult> listSportsCatalog({
    required String leagueId,
    required String weekId,
    CatalogQuery? query,
    String? timezone,
    DateTime? weekStartAt,
    DateTime? weekEndAt,
    bool forceRefresh = false,
  });

  Future<int> saveDraftSlate({
    required String leagueId,
    required String weekId,
    required String chunkKey,
    required List<Game> games,
    List<String> removeGameIds,
    String? requestId,
  });

  Future<PublishSlateResult> publishWeeklySlate({
    required String leagueId,
    required String weekId,
    String? requestId,
  });

  Future<String> createManualGame({
    required String leagueId,
    required String weekId,
    required String sportCode,
    required String leagueCode,
    required String leagueName,
    required String season,
    required DateTime scheduledAt,
    required Team homeTeam,
    required Team awayTeam,
    String? venueName,
    bool neutralSite = false,
    String? requestId,
  });

  Future<EntrySaveResult> submitOrConfirmEntry({
    required String leagueId,
    required String weekId,
    required Map<String, String> picks,
    String? requestId,
  });

  Future<CreatedWeek> createNextWeek({
    required String leagueId,
    required int sequentialNumber,
    required String label,
    required DateTime startAt,
    required DateTime endAt,
    String? pickerUid,
    String? requestId,
  });

  Future<void> assignWeeklyPicker({
    required String leagueId,
    required String weekId,
    required String pickerUid,
  });

  Future<RevealResult> revealLockedGamePicks({
    required String leagueId,
    required String weekId,
  });

  Future<int> calculateProvisionalWeekResults({
    required String leagueId,
    required String weekId,
  });

  Future<RefreshResult> refreshSelectedGames({
    required String leagueId,
    required String weekId,
    bool forceRefresh,
    String? gameId,
  });

  Future<FinalizeResult> finalizeWeek({
    required String leagueId,
    required String weekId,
  });

  Future<String> overrideGameResult({
    required String leagueId,
    required String weekId,
    required String gameId,
    required GameStatus status,
    required int? homeScore,
    required int? awayScore,
    required String? winnerTeamId,
    required String reason,
    DateTime? scheduledAtUtc,
  });

  Future<void> reopenWeek({
    required String leagueId,
    required String weekId,
    required String reason,
  });

  Stream<LeagueSummary?> watchLeague(String leagueId);

  Stream<WeekSummary?> watchWeek(String leagueId, String weekId);

  Stream<List<WeekSummary>> watchFinalizedWeeks(String leagueId);

  Stream<List<LeagueMember>> watchMembers(String leagueId);

  Stream<List<Standing>> watchStandings(String leagueId);

  Stream<List<Game>> watchWeekGames(String leagueId, String weekId);

  Stream<List<EntrySummary>> watchPublicEntries(String leagueId, String weekId);

  /// The implementation must always derive the uid from the authenticated
  /// session. Callers cannot request another member's private picks.
  Stream<List<Pick>> watchOwnPrivatePicks(String leagueId, String weekId);

  Stream<List<RevealedPick>> watchRevealedPicks(
    String leagueId,
    String weekId,
    String gameId,
  );
}

final class CreatedLeague {
  const CreatedLeague({required this.leagueId, required this.inviteCode});

  final String leagueId;
  final String inviteCode;
}

final class ArenaInvite {
  const ArenaInvite({
    required this.id,
    required this.code,
    required this.expiresAt,
    required this.maxUses,
  });

  final String id;
  final String code;
  final DateTime expiresAt;
  final int maxUses;
}

final class CreatedWeek {
  const CreatedWeek({required this.weekId, required this.pickerUid});

  final String weekId;
  final String pickerUid;
}

final class PublishSlateResult {
  const PublishSlateResult({
    required this.eligibleMemberCount,
    required this.selectedGameCount,
  });

  final int eligibleMemberCount;
  final int selectedGameCount;
}

final class EntrySaveResult {
  const EntrySaveResult({
    required this.savedPickCount,
    required this.totalRequiredPickCount,
    required this.completionState,
  });

  final int savedPickCount;
  final int totalRequiredPickCount;
  final String completionState;
}

final class RefreshResult {
  const RefreshResult({required this.updatedGameCount, required this.delayed});

  final int updatedGameCount;
  final bool delayed;
}

final class FinalizeResult {
  const FinalizeResult({
    required this.winnerUids,
    required this.highScore,
    required this.nextPickerUid,
  });

  final List<String> winnerUids;
  final int? highScore;
  final String? nextPickerUid;
}

final class LeagueSummary {
  const LeagueSummary({
    required this.id,
    required this.name,
    required this.timezone,
    required this.currentWeekId,
    required this.currentPickerUid,
    required this.pickerParticipatesInPicks,
    required this.pickLockPolicy,
    this.standingsEpoch = 0,
    this.standingsBuiltEpoch = 0,
    this.standingsBuiltMemberCount,
  });

  final String id;
  final String name;
  final String timezone;
  final String? currentWeekId;
  final String? currentPickerUid;
  final bool pickerParticipatesInPicks;
  final PickLockPolicy pickLockPolicy;
  final int standingsEpoch;
  final int standingsBuiltEpoch;
  final int? standingsBuiltMemberCount;
}

final class WeekSummary {
  const WeekSummary({
    required this.id,
    required this.sequentialNumber,
    required this.label,
    required this.pickerUid,
    required this.status,
    required this.startAt,
    required this.endAt,
    required this.finalizedAt,
    required this.winnerUids,
    required this.highScore,
    required this.pickerParticipatesInPicks,
    required this.lockPolicy,
    required this.selectedGameCount,
    required this.eligibleMemberCount,
    this.nextPickerUid,
    this.catalogPresentation = const CatalogPresentation.disabled(),
  });

  final String id;
  final int sequentialNumber;
  final String label;
  final String pickerUid;
  final String status;
  final DateTime? startAt;
  final DateTime? endAt;
  final DateTime? finalizedAt;
  final List<String> winnerUids;
  final int? highScore;
  final bool pickerParticipatesInPicks;
  final PickLockPolicy lockPolicy;
  final int selectedGameCount;
  final int eligibleMemberCount;
  final String? nextPickerUid;
  final CatalogPresentation catalogPresentation;

  bool get isFinalized => status == 'finalized';
}

final class EntrySummary {
  const EntrySummary({
    required this.uid,
    required this.eligible,
    required this.savedPickCount,
    required this.totalRequiredPickCount,
    required this.completionState,
    required this.points,
    required this.correctCount,
    required this.incorrectCount,
    required this.voidCount,
    required this.weeklyRank,
    required this.isWeeklyWinner,
  });

  final String uid;
  final bool eligible;
  final int savedPickCount;
  final int totalRequiredPickCount;
  final String completionState;
  final int points;
  final int correctCount;
  final int incorrectCount;
  final int voidCount;
  final int? weeklyRank;
  final bool isWeeklyWinner;
}

final class RevealedPick {
  const RevealedPick({
    required this.uid,
    required this.displayName,
    required this.selectedTeamId,
    required this.outcome,
    required this.points,
  });

  final String uid;
  final String displayName;
  final String selectedTeamId;
  final PickOutcome outcome;
  final int points;
}

final class RevealResult {
  const RevealResult({
    required this.revealedGameCount,
    required this.revealsByGame,
    this.payloadTruncated = false,
  });

  final int revealedGameCount;
  final Map<String, List<RevealedPick>> revealsByGame;
  final bool payloadTruncated;
}

final class RepositoryException implements Exception {
  const RepositoryException(this.code, this.safeMessage, {this.reason});

  final String code;
  final String safeMessage;
  final String? reason;

  @override
  String toString() => 'RepositoryException($code): $safeMessage';
}
