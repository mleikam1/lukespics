import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/core/domain/league_time.dart';
import 'package:timezone/data/latest.dart' as timezone_data;

void main() {
  setUpAll(timezone_data.initializeTimeZones);

  test('arena wall time converts with the arena DST offset', () {
    expect(
      leagueWallTimeToUtc(
        date: DateTime(2030, 7, 1),
        hour: 19,
        minute: 30,
        timezone: 'America/Chicago',
      ),
      DateTime.utc(2030, 7, 2, 0, 30),
    );
    expect(
      leagueWallTimeToUtc(
        date: DateTime(2030, 1, 1),
        hour: 19,
        minute: 30,
        timezone: 'America/Chicago',
      ),
      DateTime.utc(2030, 1, 2, 1, 30),
    );
  });

  test('invalid timezone and nonexistent DST wall time are rejected', () {
    expect(
      leagueWallTimeToUtc(
        date: DateTime(2030, 1, 1),
        hour: 19,
        minute: 30,
        timezone: 'Not/A_Timezone',
      ),
      isNull,
    );
    expect(
      leagueWallTimeToUtc(
        date: DateTime(2026, 3, 8),
        hour: 2,
        minute: 30,
        timezone: 'America/Chicago',
      ),
      isNull,
    );
  });

  test('reschedule sanity window is inclusive and not arena-week bound', () {
    final published = DateTime.utc(2030, 7, 1, 18);

    expect(
      isWithinGameRescheduleWindow(
        publishedScheduledAtUtc: published,
        correctedScheduledAtUtc: published.add(const Duration(days: 366)),
      ),
      isTrue,
    );
    expect(
      isWithinGameRescheduleWindow(
        publishedScheduledAtUtc: published,
        correctedScheduledAtUtc: published
            .subtract(const Duration(days: 366))
            .subtract(const Duration(milliseconds: 1)),
      ),
      isFalse,
    );
  });
}
