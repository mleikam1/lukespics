import 'package:flutter/material.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:timezone/data/latest.dart' as tz_data;

import 'app/bootstrap.dart';
import 'app/build_profile.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  tz_data.initializeTimeZones();
  usePathUrlStrategy();
  runApp(
    const KeyedSubtree(
      key: ValueKey(buildAttestation),
      child: LukesPicksBootstrap(),
    ),
  );
}
