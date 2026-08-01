import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import {setGlobalOptions} from "firebase-functions/v2";
import {
  defineBoolean,
  defineSecret,
  defineString,
} from "firebase-functions/params";

if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
db.settings({ignoreUndefinedProperties: true});

export const auth = getAuth();

export const INVITE_CODE_PEPPER = defineSecret("INVITE_CODE_PEPPER");
export const SPORTSDATAIO_API_KEY = defineSecret("SPORTSDATAIO_API_KEY");

// Secret Manager injects this value only into the four provider-bearing
// Functions that declare SPORTSDATAIO_API_KEY. Provider construction and
// catalog validation remain secret-free.
export function sportsDataIoKey(): string {
  return (process.env.SPORTSDATAIO_API_KEY ?? "").trim();
}

// API-Sports is dormant in the reviewed production manifest, so no Function
// binds or requests its optional secret. A separately authorized activation
// must add a defineSecret binding to the provider-bearing Functions; Secret
// Manager injection will then expose the value through process.env.
export function apiSportsKey(): string {
  return (process.env.API_SPORTS_KEY ?? "").trim();
}

// This deploy-time parameter is deliberately false unless the production
// provider validation and configuration gates have all been completed.
export const ALLOW_API_SPORTS_PROVIDER = defineBoolean(
  "ALLOW_API_SPORTS_PROVIDER",
  {default: false},
);

// All three gates are fail-closed. Fixture, trial, and discovery access may be
// used only for contract testing and can never activate the production path.
export const ALLOW_SPORTSDATAIO_PROVIDER = defineBoolean(
  "ALLOW_SPORTSDATAIO_PROVIDER",
  {default: false},
);
export const SPORTSDATAIO_ACCESS_MODE = defineString(
  "SPORTSDATAIO_ACCESS_MODE",
  {default: "fixture"},
);
export const SPORTSDATAIO_ENTITLEMENT_VERIFIED = defineBoolean(
  "SPORTSDATAIO_ENTITLEMENT_VERIFIED",
  {default: false},
);

export const REGION = "us-central1";

setGlobalOptions({
  region: REGION,
  minInstances: 0,
  maxInstances: 5,
  concurrency: 20,
  timeoutSeconds: 120,
  memory: "256MiB",
});

export const isEmulator =
  process.env.FUNCTIONS_EMULATOR === "true" ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;

export function positiveIntegerSetting(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}
