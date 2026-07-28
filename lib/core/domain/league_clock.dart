import 'package:timezone/timezone.dart' as tz;

abstract interface class AppClock {
  DateTime nowUtc();
}

final class SystemAppClock implements AppClock {
  const SystemAppClock();

  @override
  DateTime nowUtc() => DateTime.now().toUtc();
}

final class FixedAppClock implements AppClock {
  const FixedAppClock(this.value);

  final DateTime value;

  @override
  DateTime nowUtc() => value.toUtc();
}

final class WeekWindow {
  const WeekWindow({required this.startUtc, required this.endUtc});

  final DateTime startUtc;
  final DateTime endUtc;
}

final class LeagueWeekBoundaryCalculator {
  const LeagueWeekBoundaryCalculator({
    required this.location,
    required this.startWeekday,
    required this.startHour,
    this.startMinute = 0,
  }) : assert(startWeekday >= DateTime.monday),
       assert(startWeekday <= DateTime.sunday),
       assert(startHour >= 0 && startHour <= 23),
       assert(startMinute >= 0 && startMinute <= 59);

  final tz.Location location;
  final int startWeekday;
  final int startHour;
  final int startMinute;

  WeekWindow containing(DateTime instantUtc) {
    final local = tz.TZDateTime.from(instantUtc.toUtc(), location);
    final daysSinceStart = (local.weekday - startWeekday) % 7;
    var start = tz.TZDateTime(
      location,
      local.year,
      local.month,
      local.day - daysSinceStart,
      startHour,
      startMinute,
    );
    if (local.isBefore(start)) {
      start = tz.TZDateTime(
        location,
        start.year,
        start.month,
        start.day - 7,
        startHour,
        startMinute,
      );
    }
    final end = tz.TZDateTime(
      location,
      start.year,
      start.month,
      start.day + 7,
      startHour,
      startMinute,
    );
    return WeekWindow(startUtc: start.toUtc(), endUtc: end.toUtc());
  }
}
