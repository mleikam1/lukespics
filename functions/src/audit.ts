import type {
  DocumentData,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "./config.js";
import {sha256} from "./utils.js";

export type AuditEvent = {
  leagueId: string;
  eventType: string;
  actorUid: string;
  target: string;
  requestId: string;
  reason?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

function safeSnapshot(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  const denied = new Set([
    "email",
    "inviteCode",
    "inviteCodeHash",
    "apiKey",
    "token",
  ]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !denied.has(key)),
  );
}

function auditData(event: AuditEvent): DocumentData {
  return {
    eventType: event.eventType,
    actorUid: event.actorUid,
    target: event.target,
    timestamp: FieldValue.serverTimestamp(),
    reason: event.reason ?? null,
    before: safeSnapshot(event.before),
    after: safeSnapshot(event.after),
    requestId: event.requestId,
  };
}

export function writeAuditInTransaction(
  transaction: Transaction,
  event: AuditEvent,
): void {
  const id = sha256({
    eventType: event.eventType,
    requestId: event.requestId,
    target: event.target,
  });
  const reference = db
    .collection("leagues")
    .doc(event.leagueId)
    .collection("auditLogs")
    .doc(id);
  transaction.set(reference, auditData(event), {merge: true});
}

export async function writeAudit(
  event: AuditEvent,
  firestore: Firestore = db,
): Promise<void> {
  const id = sha256({
    eventType: event.eventType,
    requestId: event.requestId,
    target: event.target,
  });
  await firestore
    .collection("leagues")
    .doc(event.leagueId)
    .collection("auditLogs")
    .doc(id)
    .set(auditData(event), {merge: true});
}
