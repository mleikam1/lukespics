import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/data/models/sports_catalog.dart';
import 'package:lukespics/features/sports_catalog/catalog_date_window.dart';
import 'package:timezone/data/latest.dart' as timezone_data;

void main() {
  const timezone = 'America/Chicago';
  final now = DateTime.utc(2026, 7, 31, 5, 30); // Jul 31, 12:30am CDT.
  final weekStart = DateTime.utc(2026, 7, 30, 14);
  final weekEnd = DateTime.utc(2026, 8, 6, 14);

  setUpAll(timezone_data.initializeTimeZones);

  test('SportsDataIO queries use the canonical Eastern timezone', () {
    expect(
      catalogQueryTimezone(provider: 'sportsDataIo', arenaTimezone: timezone),
      sportsDataIoCatalogTimezone,
    );
    expect(
      catalogQueryTimezone(
        provider: 'theSportsDbTest',
        arenaTimezone: timezone,
      ),
      timezone,
    );
  });

  test('late-night Eastern query dates do not follow the arena day', () {
    final lateNightUtc = DateTime.utc(2026, 7, 31, 4, 30);
    final eastern = catalogDateWindow(
      mode: CatalogDateMode.today,
      nowUtc: lateNightUtc,
      timezone: sportsDataIoCatalogTimezone,
      weekStartAt: DateTime.utc(2026, 7, 30, 4),
      weekEndAt: DateTime.utc(2026, 8, 7, 4),
    );
    final central = catalogDateWindow(
      mode: CatalogDateMode.today,
      nowUtc: lateNightUtc,
      timezone: timezone,
      weekStartAt: DateTime.utc(2026, 7, 30, 4),
      weekEndAt: DateTime.utc(2026, 8, 7, 4),
    );

    expect(eastern?.from, DateTime.utc(2026, 7, 31));
    expect(central?.from, DateTime.utc(2026, 7, 30));
  });

  test('Eastern DST transitions retain one canonical calendar day', () {
    CatalogDateWindow? easternToday(DateTime instant) => catalogDateWindow(
      mode: CatalogDateMode.today,
      nowUtc: instant,
      timezone: sportsDataIoCatalogTimezone,
      weekStartAt: DateTime.utc(2026, 1, 1),
      weekEndAt: DateTime.utc(2026, 12, 31, 23, 59),
    );

    expect(
      easternToday(DateTime.utc(2026, 3, 8, 6, 30))?.from,
      DateTime.utc(2026, 3, 8),
    );
    expect(
      easternToday(DateTime.utc(2026, 3, 8, 7, 30))?.from,
      DateTime.utc(2026, 3, 8),
    );
    expect(
      easternToday(DateTime.utc(2026, 11, 1, 5, 30))?.from,
      DateTime.utc(2026, 11, 1),
    );
    expect(
      easternToday(DateTime.utc(2026, 11, 1, 6, 30))?.from,
      DateTime.utc(2026, 11, 1),
    );
  });

  test('date modes use the arena calendar and active-week bounds', () {
    final today = catalogDateWindow(
      mode: CatalogDateMode.today,
      nowUtc: now,
      timezone: timezone,
      weekStartAt: weekStart,
      weekEndAt: weekEnd,
    );
    final tomorrow = catalogDateWindow(
      mode: CatalogDateMode.tomorrow,
      nowUtc: now,
      timezone: timezone,
      weekStartAt: weekStart,
      weekEndAt: weekEnd,
    );
    final later = catalogDateWindow(
      mode: CatalogDateMode.later,
      nowUtc: now,
      timezone: timezone,
      weekStartAt: weekStart,
      weekEndAt: weekEnd,
    );
    final all = catalogDateWindow(
      mode: CatalogDateMode.allDates,
      nowUtc: now,
      timezone: timezone,
      weekStartAt: weekStart,
      weekEndAt: weekEnd,
    );

    expect(today?.from, DateTime.utc(2026, 7, 31));
    expect(today?.to, DateTime.utc(2026, 7, 31));
    expect(tomorrow?.from, DateTime.utc(2026, 8, 1));
    expect(later?.from, DateTime.utc(2026, 8, 2));
    expect(later?.to, DateTime.utc(2026, 8, 6));
    expect(all?.from, DateTime.utc(2026, 7, 31));
    expect(all?.to, DateTime.utc(2026, 8, 6));
    expect(all?.inclusiveDayCount, maximumCatalogRangeDays);
  });

  test('custom ranges clamp to the active week and seven days', () {
    final range = catalogDateWindow(
      mode: CatalogDateMode.custom,
      nowUtc: now,
      timezone: timezone,
      weekStartAt: weekStart,
      weekEndAt: weekEnd,
      customFrom: DateTime(2026, 7, 20),
      customTo: DateTime(2026, 8, 20),
    );

    expect(range?.from, DateTime.utc(2026, 7, 30));
    expect(range?.to, DateTime.utc(2026, 8, 5));
    expect(range?.inclusiveDayCount, 7);
  });

  test('a date mode outside the remaining week yields no query', () {
    final range = catalogDateWindow(
      mode: CatalogDateMode.tomorrow,
      nowUtc: DateTime.utc(2026, 8, 6, 16),
      timezone: timezone,
      weekStartAt: weekStart,
      weekEndAt: weekEnd,
    );

    expect(range, isNull);
  });

  test('single-day stepping follows arena dates and stops at week bounds', () {
    final previous = catalogSteppedDate(
      currentDate: DateTime.utc(2026, 8, 1),
      dayDelta: -1,
      timezone: timezone,
      weekStartAt: weekStart,
      weekEndAt: weekEnd,
    );
    final next = catalogSteppedDate(
      currentDate: DateTime.utc(2026, 8, 1),
      dayDelta: 1,
      timezone: timezone,
      weekStartAt: weekStart,
      weekEndAt: weekEnd,
    );

    expect(previous, DateTime.utc(2026, 7, 31));
    expect(next, DateTime.utc(2026, 8, 2));
    expect(
      catalogSteppedDate(
        currentDate: DateTime.utc(2026, 7, 30),
        dayDelta: -1,
        timezone: timezone,
        weekStartAt: weekStart,
        weekEndAt: weekEnd,
      ),
      isNull,
    );
    expect(
      catalogSteppedDate(
        currentDate: DateTime.utc(2026, 8, 6),
        dayDelta: 1,
        timezone: timezone,
        weekStartAt: weekStart,
        weekEndAt: weekEnd,
      ),
      isNull,
    );
  });
}
