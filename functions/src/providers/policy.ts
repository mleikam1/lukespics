import {HttpsError} from "firebase-functions/v2/https";
import {ALLOW_API_SPORTS_PROVIDER, ALLOW_ESPN_PROVIDER} from "../config.js";
import type {ProviderName} from "../types.js";

const AUTHORIZED_API_SPORTS_PROJECT_ID = "lukes-picks";
const AUTHORIZED_ESPN_PROJECT_ID = "lukes-picks";

export type ProviderRuntime = {
  projectId: string | null;
  emulator: boolean;
  allowTheSportsDbTest: boolean;
  allowApiSports: boolean;
  allowEspn: boolean;
};

function firebaseConfigProjectId(
  raw: string | undefined,
): string | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as {projectId?: unknown};
    return typeof parsed.projectId === "string" ? parsed.projectId : null;
  } catch {
    return null;
  }
}

export function runtimeProjectId(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const direct =
    environment.GCLOUD_PROJECT ??
    environment.GOOGLE_CLOUD_PROJECT ??
    environment.FIREBASE_PROJECT_ID;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  return firebaseConfigProjectId(environment.FIREBASE_CONFIG);
}

export function providerRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderRuntime {
  const emulator =
    environment.FUNCTIONS_EMULATOR === "true" ||
    environment.FIRESTORE_EMULATOR_HOST !== undefined;
  return {
    projectId: runtimeProjectId(environment),
    emulator,
    allowTheSportsDbTest:
      environment.ALLOW_THESPORTSDB_TEST_PROVIDER === "true",
    allowApiSports:
      environment === process.env
        ? ALLOW_API_SPORTS_PROVIDER.value()
        : environment.ALLOW_API_SPORTS_PROVIDER === "true",
    allowEspn:
      environment === process.env
        ? ALLOW_ESPN_PROVIDER.value()
        : environment.ALLOW_ESPN_PROVIDER === "true",
  };
}

export function isProviderAllowed(
  name: ProviderName,
  runtime: ProviderRuntime,
): boolean {
  if (name === "manual") return true;
  if (name === "apiSports") {
    return (
      !runtime.emulator &&
      runtime.projectId === AUTHORIZED_API_SPORTS_PROJECT_ID &&
      runtime.allowApiSports
    );
  }
  if (name === "espn") {
    return (
      !runtime.emulator &&
      runtime.projectId === AUTHORIZED_ESPN_PROJECT_ID &&
      runtime.allowEspn
    );
  }

  const internalEmulator =
    runtime.emulator && runtime.projectId === "demo-lukes-picks-local";
  if (name === "mock") return internalEmulator;
  return internalEmulator && runtime.allowTheSportsDbTest;
}

export function assertProviderAllowedForRuntime(
  name: ProviderName,
  runtime = providerRuntime(),
): void {
  if (isProviderAllowed(name, runtime)) return;

  if (name === "apiSports") {
    throw new HttpsError(
      "failed-precondition",
      "API-Sports is disabled until production provider approval and configuration are complete.",
    );
  }
  if (name === "espn") {
    throw new HttpsError(
      "failed-precondition",
      "ESPN sports data is disabled until the production terms, logo, and operational gates are complete.",
    );
  }
  if (name === "theSportsDbTest") {
    throw new HttpsError(
      "failed-precondition",
      "TheSportsDB test provider is restricted to the approved local emulator with its explicit test flag.",
    );
  }
  throw new HttpsError(
    "failed-precondition",
    "Mock sports data is restricted to the approved local emulator.",
  );
}
