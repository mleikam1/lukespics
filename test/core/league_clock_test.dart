import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/core/domain/league_clock.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

void main() {
  setUpAll(tz_data.initializeTimeZones);

  test('America/Chicago week boundaries honor spring DST transition', () {
    final calculator = LeagueWeekBoundaryCalculator(
      location: tz.getLocation('America/Chicago'),
      startWeekday: DateTime.sunday,
      startHour: 0,
    );

    final window = calculator.containing(DateTime.utc(2026, 3, 10, 12));

    expect(window.startUtc, DateTime.utc(2026, 3, 8, 6));
    expect(window.endUtc, DateTime.utc(2026, 3, 15, 5));
    expect(
      window.endUtc.difference(window.startUtc),
      const Duration(hours: 167),
    );
  });

  test('fixed clock always returns a UTC instant', () {
    final clock = FixedAppClock(DateTime(2026, 7, 27, 12));

    expect(clock.nowUtc().isUtc, isTrue);
  });
}
