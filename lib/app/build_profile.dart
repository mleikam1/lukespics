import 'package:flutter/foundation.dart' show kReleaseMode;

const bool requestedPublicRelease = bool.fromEnvironment(
  'LUKE_PICKS_PUBLIC_RELEASE',
  defaultValue: true,
);
const bool useDemoRuntime = bool.fromEnvironment('USE_DEMO');
const bool useFirebaseEmulators = bool.fromEnvironment(
  'USE_FIREBASE_EMULATORS',
);
const bool enableBrowserE2eAuth = bool.fromEnvironment(
  'ENABLE_BROWSER_E2E_AUTH',
);

const bool isConnectedPublicRelease =
    kReleaseMode &&
    requestedPublicRelease &&
    !useDemoRuntime &&
    !useFirebaseEmulators &&
    !enableBrowserE2eAuth;

const String buildAttestation = isConnectedPublicRelease
    ? 'lukes-picks-connected-public-release-v1'
    : 'lukes-picks-non-public-local-runtime-v1';
