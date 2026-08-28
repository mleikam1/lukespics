import 'dart:js_interop';

@JS('window.__lukesPicksInitialLocation')
external JSString? get _capturedInitialLocation;

@JS('window.location.href')
external JSString get _documentHref;

/// Returns the complete route captured before Flutter's web bootstrap ran.
///
/// Flutter's platform default route omits URL fragments. Reading the live
/// location from Dart can also be too late because the engine may already have
/// normalized it. The small script in `web/index.html` preserves the original
/// path, query, and fragment before loading `flutter_bootstrap.js`.
String browserInitialLocation() {
  final captured = _capturedInitialLocation?.toDart;
  if (captured != null && captured.startsWith('/')) return captured;

  // Keep a defensive fallback for nonstandard web hosts that replace the
  // generated index shell and therefore do not install the capture variable.
  final current = Uri.parse(_documentHref.toDart);
  final path = current.path.isEmpty ? '/' : current.path;
  return '$path${current.hasQuery ? '?${current.query}' : ''}'
      '${current.hasFragment ? '#${current.fragment}' : ''}';
}
