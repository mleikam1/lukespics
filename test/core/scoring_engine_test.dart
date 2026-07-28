import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/core/domain/scoring_engine.dart';
import 'package:lukespics/data/models/game.dart';
import 'package:lukespics/data/models/pick.dart';
import 'package:lukespics/data/models/week.dart';

void main() {
  const engine = ScoringEngine();
  final now = DateTime.utc(2026, 9, 14, 18);
  const home = Team(
    id: 'home',
    name: 'Harbor Hawks',
    shortName: 'Hawks',
    abbreviation: 'HH',
  );
  const away = Team(
    id: 'away',
    name: 'Prairie Foxes',
    shortName: 'Foxes',
    abbreviation: 'PF',
  );

  Game game({
    String id = 'game-1',
    GameStatus status = GameStatus.finalStatus,
    String? winner = 'home',
    int version = 1,
    DateTime? lockAt,
  }) => Game(
    id: id,
    provider: 'mock',
    providerGameId: id,
    sportCode: 'football',
    leagueCode: 'demo',
    leagueName: 'Demo League',
    season: '2026',
    scheduledAtUtc: lockAt ?? now,
    publishedScheduledAtUtc: lockAt ?? now,
    effectiveLockAtUtc: lockAt ?? now,
    homeTeam: home,
    awayTeam: away,
    status: status,
    homeScore: status == GameStatus.finalStatus ? 24 : null,
    awayScore: status == GameStatus.finalStatus ? 17 : null,
    winnerTeamId: winner,
    providerLastUpdatedAt: now,
    lastSyncedAt: now,
    resultVersion: version,
    sourcePayloadHash: '$id-$version',
  );

  Pick pick(String gameId, String teamId) => Pick(
    gameId: gameId,
    selectedTeamId: teamId,
    selectedAt: now.subtract(const Duration(hours: 2)),
    updatedAt: now.subtract(const Duration(hours: 2)),
    serverConfirmedAt: now.subtract(const Duration(hours: 2)),
    lockAtSnapshot: now,
  );

  LeagueWeek week({
    List<Game>? games,
    bool pickerParticipates = false,
    Set<String> eligible = const {'picker', 'member-a', 'member-b'},
    int resultVersion = 1,
  }) => LeagueWeek(
    id: 'week-1',
    sequentialNumber: 1,
    label: 'Week 1',
    startAt: now.subtract(const Duration(days: 2)),
    endAt: now.add(const Duration(days: 5)),
    pickerUid: 'picker',
    pickerDisplayNameSnapshot: 'Parker',
    status: WeekStatus.review,
    pickerParticipatesSnapshot: pickerParticipates,
    lockPolicySnapshot: PickLockPolicy.perGame,
    games: games ?? [game()],
    eligibleMemberUids: eligible,
    resultVersion: resultVersion,
  );

  test('correct pick earns one point and incorrect pick earns zero', () {
    final score = engine.scoreWeek(week(), [
      WeekEntryInput(
        uid: 'member-a',
        displayName: 'Alex',
        eligible: true,
        picks: {'game-1': pick('game-1', 'home')},
      ),
      WeekEntryInput(
        uid: 'member-b',
        displayName: 'Blair',
        eligible: true,
        picks: {'game-1': pick('game-1', 'away')},
      ),
    ]);

    expect(score.entries.first.correctCount, 1);
    expect(score.entries.first.points, 1);
    expect(score.entries.last.incorrectCount, 1);
    expect(score.entries.last.points, 0);
  });

  test('missing pick counts as incorrect after a final result', () {
    final score = engine.scoreWeek(week(), const [
      WeekEntryInput(
        uid: 'member-a',
        displayName: 'Alex',
        eligible: true,
        picks: {},
      ),
    ]);

    expect(score.entries.single.gradedCount, 1);
    expect(score.entries.single.incorrectCount, 1);
    expect(score.entries.single.points, 0);
  });

  test('void and cancelled games are excluded from accuracy denominator', () {
    final score = engine.scoreWeek(
      week(
        games: [
          game(status: GameStatus.voided, winner: null),
          game(id: 'game-2', status: GameStatus.cancelled, winner: null),
        ],
      ),
      [
        WeekEntryInput(
          uid: 'member-a',
          displayName: 'Alex',
          eligible: true,
          picks: {'game-1': pick('game-1', 'home')},
        ),
      ],
    );

    expect(score.entries.single.voidCount, 2);
    expect(score.entries.single.gradedCount, 0);
    expect(score.entries.single.accuracy, isNull);
  });

  test('true tie/review-required remains incomplete and ungraded', () {
    final score = engine.scoreWeek(
      week(games: [game(status: GameStatus.reviewRequired, winner: null)]),
      const [
        WeekEntryInput(
          uid: 'member-a',
          displayName: 'Alex',
          eligible: true,
          picks: {},
        ),
      ],
    );

    expect(score.complete, isFalse);
    expect(score.entries.single.gradedCount, 0);
  });

  test('equal high scores create co-winners and tied rank', () {
    final score = engine.scoreWeek(week(), [
      WeekEntryInput(
        uid: 'member-a',
        displayName: 'Alex',
        eligible: true,
        picks: {'game-1': pick('game-1', 'home')},
      ),
      WeekEntryInput(
        uid: 'member-b',
        displayName: 'Blair',
        eligible: true,
        picks: {'game-1': pick('game-1', 'home')},
      ),
    ]);

    expect(score.winnerUids, containsAll(['member-a', 'member-b']));
    expect(score.entries.map((entry) => entry.weeklyRank), everyElement(1));
    expect(
      score.entries.map((entry) => entry.isWeeklyWinner),
      everyElement(true),
    );
  });

  test('weekly picker is excluded by default and not treated as missing', () {
    final score = engine.scoreWeek(week(), const [
      WeekEntryInput(
        uid: 'picker',
        displayName: 'Parker',
        eligible: true,
        picks: {},
      ),
    ]);

    expect(score.entries.single.eligible, isFalse);
    expect(score.entries.single.gradedCount, 0);
    expect(score.entries.single.ineligibilityReason, contains('picker'));
  });

  test('weekly picker participates when setting snapshot is true', () {
    final score = engine.scoreWeek(week(pickerParticipates: true), [
      WeekEntryInput(
        uid: 'picker',
        displayName: 'Parker',
        eligible: true,
        picks: {'game-1': pick('game-1', 'home')},
      ),
    ]);

    expect(score.entries.single.eligible, isTrue);
    expect(score.entries.single.points, 1);
  });

  test('regrading same inputs is idempotent', () {
    final input = [
      WeekEntryInput(
        uid: 'member-a',
        displayName: 'Alex',
        eligible: true,
        picks: {'game-1': pick('game-1', 'home')},
      ),
    ];

    final first = engine.scoreWeek(week(), input);
    final second = engine.scoreWeek(week(), input);

    expect(second.entries.single.points, first.entries.single.points);
    expect(
      second.entries.single.gradedPicks['game-1']!.outcomeVersion,
      first.entries.single.gradedPicks['game-1']!.outcomeVersion,
    );
  });

  test(
    'provider correction produces a new outcome without double counting',
    () {
      final input = [
        WeekEntryInput(
          uid: 'member-a',
          displayName: 'Alex',
          eligible: true,
          picks: {'game-1': pick('game-1', 'home')},
        ),
      ];
      final original = engine.scoreWeek(week(), input);
      final corrected = engine.scoreWeek(
        week(games: [game(winner: 'away', version: 2)], resultVersion: 2),
        input,
      );

      expect(original.entries.single.points, 1);
      expect(corrected.entries.single.points, 0);
      expect(corrected.entries.single.gradedPicks['game-1']!.outcomeVersion, 2);
    },
  );

  test('standings use weighted accuracy across finalized weeks', () {
    WeekScore scoredWeek(String id, int correct, int incorrect) => WeekScore(
      weekId: id,
      resultVersion: 1,
      winnerUids: const [],
      highScore: correct,
      complete: true,
      entries: [
        WeekEntryResult(
          uid: 'member-a',
          displayName: 'Alex',
          eligible: true,
          gradedCount: correct + incorrect,
          correctCount: correct,
          incorrectCount: incorrect,
          voidCount: 0,
          points: correct,
          gradedPicks: const {},
        ),
      ],
    );

    final standings = engine.rebuildStandings(
      [scoredWeek('week-1', 1, 0), scoredWeek('week-2', 1, 3)],
      displayNames: const {'member-a': 'Alex'},
    );

    expect(standings.single.overallAccuracy, 0.4);
    expect(standings.single.totalPoints, 2);
    expect(standings.single.eligibleWeeks, 2);
  });

  test('schedule changes cannot reopen a locked game', () {
    final original = game(lockAt: now);
    final rescheduled = original.withRescheduledStart(
      now.add(const Duration(days: 1)),
      now.add(const Duration(minutes: 1)),
    );

    expect(rescheduled.effectiveLockAtUtc, now);
    expect(rescheduled.isLockedAt(now.add(const Duration(minutes: 1))), isTrue);
  });

  test('per-game lock leaves a later game open', () {
    final later = game(
      id: 'game-2',
      status: GameStatus.scheduled,
      winner: null,
      lockAt: now.add(const Duration(hours: 3)),
    );

    expect(later.isLockedAt(now.add(const Duration(minutes: 1))), isFalse);
  });

  test('first-game policy locks every game at the earliest start', () {
    final later = game(
      id: 'game-2',
      status: GameStatus.scheduled,
      winner: null,
      lockAt: now.add(const Duration(hours: 3)),
    );

    expect(
      later.isLockedAt(now.add(const Duration(minutes: 1)), slateLockAt: now),
      isTrue,
    );
  });

  test('member omitted from published eligibility cannot score this week', () {
    final score = engine.scoreWeek(week(eligible: const {'member-a'}), [
      WeekEntryInput(
        uid: 'late-member',
        displayName: 'Late member',
        eligible: true,
        picks: {'game-1': pick('game-1', 'home')},
      ),
    ]);

    expect(score.entries.single.eligible, isFalse);
    expect(score.entries.single.points, 0);
  });
}
