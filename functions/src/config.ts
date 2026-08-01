import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import {setGlobalOptions} from "firebase-functions/v2";
import {defineBoolean, defineSecret} from "firebase-functions/params";

if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
db.settings({ignoreUndefinedProperties: true});

export const auth = getAuth();

export const INVITE_CODE_PEPPER = defineSecret("INVITE_CODE_PEPPER");
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

// ESPN's Site API is unofficial and has no SLA or published rate limit. Keep
// the adapter deployable but production-inactive until a separate terms and
// operational review explicitly enables it for the pinned project.
export const ALLOW_ESPN_PROVIDER = defineBoolean("ALLOW_ESPN_PROVIDER", {
  default: false,
});

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
