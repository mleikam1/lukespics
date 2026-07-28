import 'package:flutter/widgets.dart';

enum WindowClass { mobile, tablet, desktop }

abstract final class AppBreakpoints {
  static const mobile = 600.0;
  static const desktop = 1024.0;
  static const maxContent = 1360.0;

  static WindowClass of(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    if (width < mobile) return WindowClass.mobile;
    if (width < desktop) return WindowClass.tablet;
    return WindowClass.desktop;
  }

  static bool isMobile(BuildContext context) =>
      of(context) == WindowClass.mobile;

  static EdgeInsets pagePadding(BuildContext context) => switch (of(context)) {
    WindowClass.mobile => const EdgeInsets.fromLTRB(16, 20, 16, 28),
    WindowClass.tablet => const EdgeInsets.fromLTRB(24, 28, 24, 36),
    WindowClass.desktop => const EdgeInsets.fromLTRB(36, 36, 36, 48),
  };
}
