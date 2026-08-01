import {logger} from "firebase-functions";
import {HttpsError} from "firebase-functions/v2/https";
import {ProviderRetryAuthorizationError} from "./retry.js";

export const SPORTSDATAIO_ORIGIN = "https://api.sportsdata.io";
export const SPORTSDATAIO_MAX_REQUEST_ATTEMPTS = 3;
export const SPORTSDATAIO_DEFAULT_TIMEOUT_MS = 8_000;
export const SPORTSDATAIO_DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;
export const SPORTSDATAIO_MAX_RETRY_AFTER_MS = 5_000;
export const SPORTSDATAIO_KEY_CONFIGURATION_REASON =
  "sportsdataio-api-key-not-configured";
export const SPORTSDATAIO_KEY_CONFIGURATION_MESSAGE =
  "SportsDataIO API key is not configured.";
export const SPORTSDATAIO_CREDENTIALS_CONFIGURATION_REASON =
  "sportsdataio-credentials-rejected";
export const SPORTSDATAIO_CREDENTIALS_CONFIGURATION_MESSAGE =
  "SportsDataIO server credentials need administrator configuration.";
export const SPORTSDATAIO_ENTITLEMENT_CONFIGURATION_REASON =
  "sportsdataio-feed-not-entitled";
export const SPORTSDATAIO_ENTITLEMENT_CONFIGURATION_MESSAGE =
  "SportsDataIO league feed entitlement needs administrator configuration.";

const SPORTSDATAIO_CONFIGURATION_REASONS = new Set<string>([
  SPORTSDATAIO_KEY_CONFIGURATION_REASON,
  SPORTSDATAIO_CREDENTIALS_CONFIGURATION_REASON,
  SPORTSDATAIO_ENTITLEMENT_CONFIGURATION_REASON,
]);

export function isSportsDataIoConfigurationReason(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    SPORTSDATAIO_CONFIGURATION_REASONS.has(value)
  );
}

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

export type SportsDataIoLeague = "nfl" | "mlb";

export type SportsDataIoEndpoint =
  | {league: "nfl"; resource: "CurrentSeason" | "CurrentWeek" | "Teams"}
  | {
      league: "nfl";
      resource: "SchedulesBasic";
      season: string;
    }
  | {
      league: "nfl";
      resource: "ScoresByDate";
      date: string;
    }
  | {league: "mlb"; resource: "CurrentSeason" | "teams"}
  | {
      league: "mlb";
      resource: "GamesByDate";
      date: string;
    };

export type SportsDataIoClientOptions = {
  getApiKey: () => string | Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  random?: () => number;
  timeoutMs?: number;
  maximumResponseBytes?: number;
};

type RetryableFailure = {
  kind: "rate-limit" | "upstream" | "network" | "timeout";
  retryAfterMs: number | null;
};

class NonRetryableSportsDataIoError extends Error {
  constructor(
    message: string,
    readonly code:
      | "failed-precondition"
      | "unauthenticated"
      | "permission-denied"
      | "data-loss",
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = "NonRetryableSportsDataIoError";
  }
}

class RetryableSportsDataIoError extends Error {
  constructor(readonly failure: RetryableFailure) {
    super("SportsDataIO request failed transiently.");
    this.name = "RetryableSportsDataIoError";
  }
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function formatSportsDataIoDate(value: string): string {
  if (!isValidIsoDate(value)) {
    throw new Error("SportsDataIO dates must be valid YYYY-MM-DD dates.");
  }
  const [year = "", monthText = "", day = ""] = value.split("-");
  const month = MONTHS[Number(monthText) - 1];
  if (month === undefined) {
    throw new Error("SportsDataIO dates contain an invalid month.");
  }
  return `${year}-${month}-${day}`;
}

const NFL_SEASON_PATTERN = /^\d{4}(?:REG|PRE|POST|STAR)?$/;
const MLB_SEASON_PATTERN = /^\d{4}(?:REG|PRE|POST|STAR)?$/;

export function isSportsDataIoNflSeason(value: string): boolean {
  return NFL_SEASON_PATTERN.test(value);
}

export function isSportsDataIoMlbSeason(value: string): boolean {
  return MLB_SEASON_PATTERN.test(value);
}

export function assertSportsDataIoNflSeason(value: string): string {
  if (!isSportsDataIoNflSeason(value)) {
    throw new Error("SportsDataIO NFL season is invalid.");
  }
  return value;
}

export function assertSportsDataIoMlbSeason(value: string): string {
  if (!isSportsDataIoMlbSeason(value)) {
    throw new Error("SportsDataIO MLB season is invalid.");
  }
  return value;
}

export function enumerateIsoDates(
  from: string,
  to: string,
  maximumDays = 7,
): string[] {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new HttpsError(
      "invalid-argument",
      "Sports catalog dates must use valid YYYY-MM-DD values.",
    );
  }
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (end < start) {
    throw new HttpsError(
      "invalid-argument",
      "Sports catalog end date must not precede its start date.",
    );
  }
  const dayCount = Math.floor((end - start) / 86_400_000) + 1;
  if (dayCount > maximumDays) {
    throw new HttpsError(
      "invalid-argument",
      `SportsDataIO catalog ranges may contain at most ${maximumDays} days.`,
    );
  }
  return Array.from({length: dayCount}, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

export async function settledOrThrow<T extends readonly unknown[]>(
  promises: {[K in keyof T]: Promise<T[K]>},
): Promise<T> {
  const results = await Promise.allSettled(promises);
  const failure =
    results.find(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof ProviderRetryAuthorizationError,
    ) ?? results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map((result) => {
    if (result.status !== "fulfilled") {
      throw new Error("SportsDataIO request batch failed.");
    }
    return result.value;
  }) as unknown as T;
}

export function sportsDataIoEndpointPath(
  endpoint: SportsDataIoEndpoint,
): string {
  switch (endpoint.resource) {
  case "CurrentSeason":
    return `/v3/${endpoint.league}/scores/json/CurrentSeason`;
  case "CurrentWeek":
  case "Teams":
    return `/v3/nfl/scores/json/${endpoint.resource}`;
  case "SchedulesBasic":
    return `/v3/nfl/scores/json/SchedulesBasic/${assertSportsDataIoNflSeason(endpoint.season)}`;
  case "ScoresByDate":
    return `/v3/nfl/scores/json/ScoresByDate/${formatSportsDataIoDate(endpoint.date)}`;
  case "teams":
    return "/v3/mlb/scores/json/teams";
  case "GamesByDate":
    return `/v3/mlb/scores/json/GamesByDate/${formatSportsDataIoDate(endpoint.date)}`;
  }
}

export function resolveSportsDataIoUrl(
  endpoint: SportsDataIoEndpoint,
): URL {
  const url = new URL(sportsDataIoEndpointPath(endpoint), SPORTSDATAIO_ORIGIN);
  if (
    url.origin !== SPORTSDATAIO_ORIGIN ||
    !url.pathname.startsWith("/v3/") ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("SportsDataIO URL escaped the strict League API allowlist.");
  }
  return url;
}

function parseRetryAfter(
  value: string | null,
  now: Date,
): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return Math.min(
      SPORTSDATAIO_MAX_RETRY_AFTER_MS,
      Math.max(0, Math.ceil(Number(normalized) * 1000)),
    );
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(
    SPORTSDATAIO_MAX_RETRY_AFTER_MS,
    Math.max(0, parsed - now.valueOf()),
  );
}

function timeoutLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

export async function boundedSportsDataIoResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new NonRetryableSportsDataIoError(
      "SportsDataIO response exceeded the safe size limit.",
      "data-loss",
    );
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      byteCount += next.value.byteLength;
      if (byteCount > maximumBytes) {
        await reader.cancel();
        throw new NonRetryableSportsDataIoError(
          "SportsDataIO response exceeded the safe size limit.",
          "data-loss",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf8",
  );
}

function safePublicError(error: NonRetryableSportsDataIoError): HttpsError {
  return error.details === undefined
    ? new HttpsError(error.code, error.message)
    : new HttpsError(error.code, error.message, error.details);
}

function finalRetryError(failure: RetryableFailure): HttpsError {
  if (failure.kind === "rate-limit") {
    return new HttpsError(
      "resource-exhausted",
      "Sports data refresh is temporarily rate limited.",
    );
  }
  return new HttpsError(
    "unavailable",
    "SportsDataIO is temporarily unavailable.",
  );
}

export class SportsDataIoClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;
  private retryAuthorizer: (() => Promise<void>) | null = null;
  private requestAttemptCount = 0;

  constructor(private readonly options: SportsDataIoClientOptions) {
    this.fetchImplementation = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.timeoutMs = boundedPositiveInteger(
      options.timeoutMs,
      SPORTSDATAIO_DEFAULT_TIMEOUT_MS,
      30_000,
    );
    this.maximumResponseBytes = boundedPositiveInteger(
      options.maximumResponseBytes,
      SPORTSDATAIO_DEFAULT_MAX_RESPONSE_BYTES,
      10_000_000,
    );
  }

  getRequestAttemptCount(): number {
    return this.requestAttemptCount;
  }

  setRetryAuthorizer(authorizer: (() => Promise<void>) | null): void {
    if (authorizer !== null && this.retryAuthorizer !== null) {
      throw new Error("SportsDataIO retry authorization is already installed.");
    }
    this.retryAuthorizer = authorizer;
  }

  async getJson(endpoint: SportsDataIoEndpoint): Promise<unknown> {
    const url = resolveSportsDataIoUrl(endpoint);
    let finalFailure: RetryableFailure | null = null;

    for (
      let attempt = 0;
      attempt < SPORTSDATAIO_MAX_REQUEST_ATTEMPTS;
      attempt += 1
    ) {
      if (attempt > 0) {
        if (this.retryAuthorizer === null) {
          throw new ProviderRetryAuthorizationError(
            new HttpsError(
              "failed-precondition",
              "SportsDataIO retry authorization is unavailable.",
            ),
          );
        }
        try {
          await this.retryAuthorizer();
        } catch (error: unknown) {
          throw new ProviderRetryAuthorizationError(error);
        }
      }

      const apiKey = (await this.options.getApiKey()).trim();
      if (apiKey.length === 0 || apiKey.length > 512) {
        throw new HttpsError(
          "failed-precondition",
          SPORTSDATAIO_KEY_CONFIGURATION_MESSAGE,
          {reason: SPORTSDATAIO_KEY_CONFIGURATION_REASON},
        );
      }

      const attemptStartedAt = Date.now();
      try {
        this.requestAttemptCount += 1;
        const response = await this.fetchImplementation(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            "Ocp-Apim-Subscription-Key": apiKey,
          },
          redirect: "error",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new NonRetryableSportsDataIoError(
              SPORTSDATAIO_CREDENTIALS_CONFIGURATION_MESSAGE,
              "failed-precondition",
              {reason: SPORTSDATAIO_CREDENTIALS_CONFIGURATION_REASON},
            );
          }
          if (response.status === 403) {
            throw new NonRetryableSportsDataIoError(
              SPORTSDATAIO_ENTITLEMENT_CONFIGURATION_MESSAGE,
              "failed-precondition",
              {reason: SPORTSDATAIO_ENTITLEMENT_CONFIGURATION_REASON},
            );
          }
          if (response.status === 429) {
            throw new RetryableSportsDataIoError({
              kind: "rate-limit",
              retryAfterMs: parseRetryAfter(
                response.headers.get("retry-after"),
                this.now(),
              ),
            });
          }
          if (response.status >= 500) {
            throw new RetryableSportsDataIoError({
              kind: "upstream",
              retryAfterMs: parseRetryAfter(
                response.headers.get("retry-after"),
                this.now(),
              ),
            });
          }
          throw new NonRetryableSportsDataIoError(
            "SportsDataIO rejected the allowlisted request.",
            "failed-precondition",
          );
        }

        const body = await boundedSportsDataIoResponseText(
          response,
          this.maximumResponseBytes,
        );
        try {
          const parsed = JSON.parse(body) as unknown;
          logger.info("SportsDataIO request completed", {
            provider: "sportsDataIo",
            league: endpoint.league,
            endpointCategory: endpoint.resource,
            durationMs: Date.now() - attemptStartedAt,
            retryCount: attempt,
            outcome: "success",
          });
          return parsed;
        } catch {
          throw new NonRetryableSportsDataIoError(
            "SportsDataIO returned malformed JSON.",
            "data-loss",
          );
        }
      } catch (error: unknown) {
        if (error instanceof NonRetryableSportsDataIoError) {
          logger.warn("SportsDataIO request failed", {
            provider: "sportsDataIo",
            league: endpoint.league,
            endpointCategory: endpoint.resource,
            durationMs: Date.now() - attemptStartedAt,
            retryCount: attempt,
            safeErrorCode: error.code,
          });
          throw safePublicError(error);
        }
        const failure =
          error instanceof RetryableSportsDataIoError
            ? error.failure
            : {
                kind: timeoutLike(error) ? "timeout" : "network",
                retryAfterMs: null,
              } satisfies RetryableFailure;
        finalFailure = failure;
        logger.warn("SportsDataIO request attempt delayed", {
          provider: "sportsDataIo",
          league: endpoint.league,
          endpointCategory: endpoint.resource,
          durationMs: Date.now() - attemptStartedAt,
          retryCount: attempt,
          safeErrorCode: failure.kind,
        });
        if (attempt === SPORTSDATAIO_MAX_REQUEST_ATTEMPTS - 1) {
          throw finalRetryError(failure);
        }

        const jitter = Math.floor(
          Math.min(0.999_999, Math.max(0, this.random())) * 100,
        );
        const backoff = 250 * 2 ** attempt + jitter;
        const retryAfter = failure.retryAfterMs;
        await this.sleep(
          retryAfter === null
            ? backoff
            : Math.min(
                SPORTSDATAIO_MAX_RETRY_AFTER_MS,
                Math.max(backoff, retryAfter),
              ),
        );
      }
    }

    throw finalRetryError(
      finalFailure ?? {kind: "network", retryAfterMs: null},
    );
  }
}
