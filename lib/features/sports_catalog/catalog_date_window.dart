import '../../core/domain/league_time.dart';
import '../../data/models/sports_catalog.dart';

const int maximumCatalogRangeDays = 7;

final class CatalogDateWindow {
  const CatalogDateWindow({required this.from, required this.to});

  /// Calendar dates encoded as UTC-midnight values.
  ///
  /// These are date-only values, not instants to be converted to another
  /// timezone before serialization.
  final DateTime from;
  final DateTime to;

  int get inclusiveDayCount => to.difference(from).inDays + 1;
}

CatalogDateWindow? catalogDateWindow({
  required CatalogDateMode mode,
  required DateTime nowUtc,
  required String timezone,
  required DateTime weekStartAt,
  required DateTime weekEndAt,
  DateTime? customFrom,
  DateTime? customTo,
}) {
  final today = _calendarDate(inLeagueTimezone(nowUtc, timezone));
  final weekStart = _calendarDate(
    inLeagueTimezone(weekStartAt.toUtc(), timezone),
  );
  final weekEnd = _calendarDate(inLeagueTimezone(weekEndAt.toUtc(), timezone));
  if (weekEnd.isBefore(weekStart)) return null;

  DateTime from;
  DateTime to;
  switch (mode) {
    case CatalogDateMode.today:
      from = today;
      to = today;
    case CatalogDateMode.tomorrow:
      from = today.add(const Duration(days: 1));
      to = from;
    case CatalogDateMode.later:
      from = today.add(const Duration(days: 2));
      to = weekEnd;
    case CatalogDateMode.allDates:
      from = today.isAfter(weekStart) ? today : weekStart;
      to = weekEnd;
    case CatalogDateMode.custom:
      if (customFrom == null || customTo == null) return null;
      from = _calendarDate(customFrom);
      to = _calendarDate(customTo);
  }

  if (from.isBefore(weekStart)) from = weekStart;
  if (to.isAfter(weekEnd)) to = weekEnd;
  if (to.isBefore(from)) return null;

  final maximumTo = from.add(const Duration(days: maximumCatalogRangeDays - 1));
  if (to.isAfter(maximumTo)) to = maximumTo;
  return CatalogDateWindow(from: from, to: to);
}

DateTime catalogCalendarDate(DateTime instant, String timezone) =>
    _calendarDate(inLeagueTimezone(instant.toUtc(), timezone));

DateTime? catalogSteppedDate({
  required DateTime currentDate,
  required int dayDelta,
  required String timezone,
  required DateTime weekStartAt,
  required DateTime weekEndAt,
}) {
  final first = catalogCalendarDate(weekStartAt, timezone);
  final last = catalogCalendarDate(weekEndAt, timezone);
  if (last.isBefore(first)) return null;

  final stepped = _calendarDate(currentDate).add(Duration(days: dayDelta));
  if (stepped.isBefore(first) || stepped.isAfter(last)) return null;
  return stepped;
}

DateTime _calendarDate(DateTime value) =>
    DateTime.utc(value.year, value.month, value.day);
