import {createHash, createHmac, randomBytes, randomUUID} from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {isEmulator} from "./config.js";
import type {NormalizedGame, StoredGame} from "./types.js";

const MAX_CALLABLE_BYTES = 200_000;

export function assertPayloadSize(value: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > MAX_CALLABLE_BYTES) {
    throw new HttpsError(
      "invalid-argument",
      "This request is too large. Send long slates in smaller chunks.",
    );
  }
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function opaqueHash(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value).digest("hex");
}

export function getInvitePepper(): string {
  const configured = process.env.INVITE_CODE_PEPPER?.trim();
  if (configured !== undefined && configured.length >= 32) {
    return configured;
  }
  if (isEmulator) {
    return "emulator-only-invite-pepper-000000000000";
  }
  throw new HttpsError(
    "failed-precondition",
    "Invite service is not configured.",
  );
}

export function createInviteCode(): string {
  return randomBytes(18).toString("base64url");
}

export function safeRequestId(candidate?: string): string {
  return candidate ?? randomUUID().replaceAll("-", "");
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "lukes-picks-arena";
}

export function toStoredGame(game: NormalizedGame): StoredGame {
  return {
    ...game,
    scheduledAtUtc: Timestamp.fromDate(game.scheduledAtUtc),
    publishedScheduledAtUtc: Timestamp.fromDate(
      game.publishedScheduledAtUtc,
    ),
    effectiveLockAtUtc: Timestamp.fromDate(game.effectiveLockAtUtc),
    providerLastUpdatedAt: Timestamp.fromDate(game.providerLastUpdatedAt),
    lastSyncedAt: Timestamp.fromDate(game.lastSyncedAt),
  };
}

export function asDate(value: unknown, field: string): Date {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  throw new HttpsError("failed-precondition", `Invalid ${field}.`);
}

export async function commitWritesInChunks<T>(
  db: Firestore,
  items: T[],
  write: (batch: WriteBatch, item: T) => void,
  chunkSize = 400,
): Promise<void> {
  for (let index = 0; index < items.length; index += chunkSize) {
    const batch = db.batch();
    for (const item of items.slice(index, index + chunkSize)) {
      write(batch, item);
    }
    await batch.commit();
  }
}

export async function deleteRefsInChunks(
  db: Firestore,
  refs: DocumentReference[],
): Promise<void> {
  await commitWritesInChunks(db, refs, (batch, reference) => {
    batch.delete(reference);
  });
}

export function serverTimestamp(): FieldValue {
  return FieldValue.serverTimestamp();
}

export function sanitizedIp(rawIp: string | undefined): string {
  if (rawIp === undefined || rawIp.length === 0) {
    return "unknown";
  }
  return rawIp.split(",")[0]?.trim().slice(0, 64) ?? "unknown";
}
