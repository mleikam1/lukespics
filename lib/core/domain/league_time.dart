import 'package:intl/intl.dart';
import 'package:timezone/timezone.dart' as tz;

DateTime inLeagueTimezone(DateTime instant, String timezone) {
  try {
    return tz.TZDateTime.from(instant.toUtc(), tz.getLocation(timezone));
  } on Object {
    return instant.toUtc();
  }
}

String formatLeagueTime(DateTime instant, String timezone, String pattern) =>
    DateFormat(pattern).format(inLeagueTimezone(instant, timezone));

int leagueDayDelta(DateTime instant, DateTime nowUtc, String timezone) {
  final localInstant = inLeagueTimezone(instant, timezone);
  final localNow = inLeagueTimezone(nowUtc, timezone);
  return DateTime(
    localInstant.year,
    localInstant.month,
    localInstant.day,
  ).difference(DateTime(localNow.year, localNow.month, localNow.day)).inDays;
}
