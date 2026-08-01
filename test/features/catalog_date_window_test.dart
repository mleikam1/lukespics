import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/data/models/sports_catalog.dart';
import 'package:lukespics/features/sports_catalog/catalog_date_window.dart';

void main() {
  const timezone = 'America/Chicago';
  final now = DateTime.utc(2026, 7, 31, 5, 30); // Jul 31, 12:30am CDT.
  final weekStart = DateTime.utc(2026, 7, 30, 14);
  final weekEnd = DateTime.utc(2026, 8, 6, 14);

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
