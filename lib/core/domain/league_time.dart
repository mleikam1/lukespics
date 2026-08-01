import 'package:intl/intl.dart';
import 'package:timezone/timezone.dart' as tz;

const gameRescheduleSanityWindow = Duration(days: 366);

DateTime inLeagueTimezone(DateTime instant, String timezone) {
  try {
    return tz.TZDateTime.from(instant.toUtc(), tz.getLocation(timezone));
  } on Object {
    return instant.toUtc();
  }
}

String formatLeagueTime(DateTime instant, String timezone, String pattern) =>
    DateFormat(pattern).format(inLeagueTimezone(instant, timezone));

/// Converts a calendar date and wall-clock time in an arena timezone to UTC.
///
/// Returns null for an unknown timezone or a nonexistent local time during a
/// daylight-saving transition instead of silently using the device timezone.
DateTime? leagueWallTimeToUtc({
  required DateTime date,
  required int hour,
  required int minute,
  required String timezone,
}) {
  try {
    final local = tz.TZDateTime(
      tz.getLocation(timezone),
      date.year,
      date.month,
      date.day,
      hour,
      minute,
    );
    if (local.year != date.year ||
        local.month != date.month ||
        local.day != date.day ||
        local.hour != hour ||
        local.minute != minute) {
      return null;
    }
    return local.toUtc();
  } on Object {
    return null;
  }
}

bool isWithinGameRescheduleWindow({
  required DateTime publishedScheduledAtUtc,
  required DateTime correctedScheduledAtUtc,
}) {
  final published = publishedScheduledAtUtc.toUtc();
  final corrected = correctedScheduledAtUtc.toUtc();
  return !corrected.isBefore(published.subtract(gameRescheduleSanityWindow)) &&
      !corrected.isAfter(published.add(gameRescheduleSanityWindow));
}

int leagueDayDelta(DateTime instant, DateTime nowUtc, String timezone) {
  final localInstant = inLeagueTimezone(instant, timezone);
  final localNow = inLeagueTimezone(nowUtc, timezone);
  return DateTime(
    localInstant.year,
    localInstant.month,
    localInstant.day,
  ).difference(DateTime(localNow.year, localNow.month, localNow.day)).inDays;
}
