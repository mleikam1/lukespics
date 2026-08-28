import {
  FieldValue,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {writeAudit, writeAuditInTransaction} from "../audit.js";
import {
  requireAdmin,
  requireMembership,
  requireOwner,
  type AuthenticatedUser,
} from "../authz.js";
import {auth, db} from "../config.js";
import {getProvider} from "../providers/factory.js";
import {assertProviderAllowedForRuntime} from "../providers/policy.js";
import type {LeagueSettings, MemberRole} from "../types.js";
import {
  commitWritesInChunks,
  createInviteCode,
  getInvitePepper,
  opaqueHash,
  sanitizedIp,
  sha256,
  slugify,
  stableJson,
} from "../utils.js";

const DEFAULT_SETTINGS: LeagueSettings = {
  pickerParticipatesInPicks: false,
  pickLockPolicy: "perGame",
  weekStartDay: 1,
  weekStartTime: "09:00",
  enabledSports: [],
  enabledLeagues: [],
  manualFinalizationRequired: true,
  providerName: "manual",
  providerBySport: {},
};

export const DEFAULT_ARENA_INVITE_LIFETIME_MS = 14 * 24 * 60 * 60_000;
export const DEFAULT_ARENA_INVITE_MAX_USES = 50;
export const SHORT_ARENA_INVITE_CODE_LENGTH = 8;
const SHORT_ARENA_INVITE_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SHORT_ARENA_INVITE_CANDIDATE_COUNT = 4;
const REVOKED_INVITE_RETENTION_MS = 90 * 24 * 60 * 60_000;
const USER_JOIN_ATTEMPT_LIMIT = 5;
const NETWORK_JOIN_ATTEMPT_LIMIT = 20;

export type ArenaInviteCodeFormatVersion = 1 | 2;

type ArenaInviteIdentity = {
  leagueId: string;
  actorUid: string;
  requestId: string;
};

export function arenaInviteCodeForRequest(
  input: ArenaInviteIdentity,
  pepper: string,
  codeFormatVersion: ArenaInviteCodeFormatVersion = 2,
  derivationIndex = 0,
): string {
  const digest = opaqueHash(stableJson({
    purpose: "arena-invite-code",
    version: codeFormatVersion,
    ...(codeFormatVersion === 1 ? {} : {derivationIndex}),
    ...input,
  }), pepper);
  if (codeFormatVersion === 1) {
    return Buffer.from(digest.slice(0, 36), "hex").toString("base64url");
  }
  return [...Buffer.from(digest, "hex")
    .subarray(0, SHORT_ARENA_INVITE_CODE_LENGTH)]
    .map((byte) => SHORT_ARENA_INVITE_ALPHABET.charAt(byte & 31))
    .join("");
}

export function arenaInviteIdForRequest(input: ArenaInviteIdentity): string {
  return `invite-${sha256({
    purpose: "arena-invite-id",
    version: 1,
    ...input,
  }).slice(0, 32)}`;
}

export function withCbsProviderForNewLeague(
  settings: Partial<LeagueSettings>,
  cbsEnabled: boolean,
): Partial<LeagueSettings> {
  if (!cbsEnabled) return settings;
  return {
    ...settings,
    providerBySport: {
      ...(settings.providerBySport ?? {}),
      NCAAF: "cbsSports",
    },
  };
}

export async function ensureProfile(
  user: AuthenticatedUser,
  input: {
    displayName?: string;
    photoUrl?: string | null;
  },
): Promise<{uid: string}> {
  const reference = db.collection("users").doc(user.uid);
  const snapshot = await reference.get();
  await reference.set(
    {
      uid: user.uid,
      email: user.email,
      displayName: input.displayName ?? user.displayName,
      photoUrl: input.photoUrl ?? user.photoUrl,
      createdAt: snapshot.exists
        ? snapshot.data()?.createdAt ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastLoginAt: FieldValue.serverTimestamp(),
      accountStatus: "active",
    },
    {merge: true},
  );
  return {uid: user.uid};
}

function inviteReferences(codeHash: string, leagueId: string): {
  mapping: DocumentReference;
  config: DocumentReference;
} {
  return {
    mapping: db.collection("joinCodeMappings").doc(codeHash),
    config: db
      .collection("leagues")
      .doc(leagueId)
      .collection("private")
      .doc("invite"),
  };
}

function independentInviteReferences(input: {
  codeHash: string;
  leagueId: string;
  inviteId: string;
}): {
  mapping: DocumentReference;
  metadata: DocumentReference;
} {
  return {
    mapping: db.collection("joinCodeMappings").doc(input.codeHash),
    metadata: db
      .collection("leagues")
      .doc(input.leagueId)
      .collection("privateInvites")
      .doc(input.inviteId),
  };
}

export async function createLeagueRecord(input: {
  user: AuthenticatedUser;
  requestId: string;
  name: string;
  timezone: string;
  settings: Partial<LeagueSettings>;
}): Promise<{leagueId: string; inviteCode: string}> {
  const leagueId = `league-${sha256({
    uid: input.user.uid,
    requestId: input.requestId,
  }).slice(0, 24)}`;
  const leagueReference = db.collection("leagues").doc(leagueId);
  const inviteCode = createInviteCode();
  const inviteCodeHash = opaqueHash(inviteCode, getInvitePepper());
  const invite = inviteReferences(inviteCodeHash, leagueId);
  const settings = {...DEFAULT_SETTINGS, ...input.settings};
  assertProviderAllowedForRuntime(settings.providerName);
  for (const provider of Object.values(settings.providerBySport)) {
    assertProviderAllowedForRuntime(provider);
  }
  const baseSlug = slugify(input.name);
  const slug = `${baseSlug}-${leagueId.slice(-6)}`;

  const created = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(leagueReference);
    if (existing.exists) return false;
    const activeMemberships = await transaction.get(
      db
        .collectionGroup("members")
        .where("uid", "==", input.user.uid)
        .where("status", "==", "active")
        .limit(1),
    );
    if (!activeMemberships.empty) {
      throw new HttpsError(
        "already-exists",
        "You already belong to an active arena.",
      );
    }
    transaction.create(leagueReference, {
      name: input.name,
      slug,
      ownerUid: input.user.uid,
      timezone: input.timezone,
      status: "active",
      currentWeekId: null,
      currentPickerUid: input.user.uid,
      rotationCursor: 0,
      standingsEpoch: 0,
      standingsBuiltEpoch: 0,
      standingsBuiltMemberCount: 0,
      settings,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(
      leagueReference.collection("members").doc(input.user.uid),
      {
        uid: input.user.uid,
        displayName: input.user.displayName,
        photoUrl: input.user.photoUrl,
        role: "owner",
        status: "active",
        rotationOrder: 0,
        joinedAt: FieldValue.serverTimestamp(),
        eligibleFromWeekId: null,
        lastActiveAt: FieldValue.serverTimestamp(),
      },
    );
    transaction.create(invite.config, {
      inviteCodeHash,
      generatedAt: FieldValue.serverTimestamp(),
      generatedBy: input.user.uid,
      expiresAt: null,
      maxUses: null,
      useCount: 0,
      active: true,
    });
    transaction.create(invite.mapping, {
      leagueId,
      active: true,
      expiresAt: null,
      maxUses: null,
      useCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(db.collection("leagueSlugs").doc(slug), {leagueId});
    writeAuditInTransaction(transaction, {
      leagueId,
      eventType: "league_created",
      actorUid: input.user.uid,
      target: `leagues/${leagueId}`,
      requestId: input.requestId,
      after: {name: input.name, timezone: input.timezone, settings},
    });
    return true;
  });

  if (!created) {
    throw new HttpsError(
      "already-exists",
      "This create request has already completed.",
      {leagueId},
    );
  }
  return {leagueId, inviteCode};
}

async function recordJoinAttempt(
  uid: string,
  request: CallableRequest,
): Promise<void> {
  const pepper = getInvitePepper();
  const ipHash = opaqueHash(sanitizedIp(request.rawRequest.ip), pepper);
  const collection = db.collection("joinAttemptLimits");
  const references = [
    collection.doc(`user-${sha256(uid)}`),
    collection.doc(`ip-${ipHash}`),
  ];
  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(
      references.map(async (reference) => transaction.get(reference)),
    );
    const states = snapshots.map((snapshot) => {
      const data = snapshot.data();
      const windowStartedAt = data?.windowStartedAt;
      const currentWindow =
        windowStartedAt instanceof Timestamp &&
        windowStartedAt.toMillis() > Date.now() - 15 * 60_000;
      const attempts =
        currentWindow && typeof data?.attempts === "number"
          ? data.attempts
          : 0;
      return {windowStartedAt, currentWindow, attempts};
    });
    if (states.some((state, index) =>
      state.attempts >= (index === 0
        ? USER_JOIN_ATTEMPT_LIMIT
        : NETWORK_JOIN_ATTEMPT_LIMIT))) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many join attempts. Try again later.",
      );
    }
    for (const [index, reference] of references.entries()) {
      const state = states[index];
      transaction.set(reference, {
        scope: index === 0 ? "user" : "network",
        attempts: (state?.attempts ?? 0) + 1,
        windowStartedAt:
          state?.currentWindow === true
            ? state.windowStartedAt
            : FieldValue.serverTimestamp(),
        lastAttemptAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60_000),
      });
    }
  });
}

export async function joinByInvite(input: {
  user: AuthenticatedUser;
  request: CallableRequest;
  requestId: string;
  inviteCode: string;
  nickname?: string;
}): Promise<{leagueId: string}> {
  await recordJoinAttempt(input.user.uid, input.request);
  const codeHash = opaqueHash(input.inviteCode, getInvitePepper());
  const mappingReference = db.collection("joinCodeMappings").doc(codeHash);
  const result = await db.runTransaction(async (transaction) => {
    const mappingSnapshot = await transaction.get(mappingReference);
    const mapping = mappingSnapshot.data();
    const expiresAt = mapping?.expiresAt;
    if (
      !mappingSnapshot.exists ||
      typeof mapping?.leagueId !== "string" ||
      mapping.leagueId.length === 0
    ) {
      throw new HttpsError("not-found", "Invite code is invalid or expired.");
    }
    const useCount =
      typeof mapping.useCount === "number" ? mapping.useCount : 0;
    const maxUses =
      typeof mapping.maxUses === "number" ? mapping.maxUses : null;
    const leagueId = mapping.leagueId;
    const leagueReference = db.collection("leagues").doc(leagueId);
    const inviteId =
      typeof mapping.inviteId === "string" ? mapping.inviteId : null;
    const inviteCounterReference = inviteId === null
      ? leagueReference.collection("private").doc("invite")
      : leagueReference.collection("privateInvites").doc(inviteId);
    const memberReference = leagueReference
      .collection("members")
      .doc(input.user.uid);
    const [
      leagueSnapshot,
      memberSnapshot,
      orderedMembers,
      inviteCounterSnapshot,
      activeMemberships,
    ] = await Promise.all([
      transaction.get(leagueReference),
      transaction.get(memberReference),
      transaction.get(
        leagueReference
          .collection("members")
          .orderBy("rotationOrder", "desc")
          .limit(1),
      ),
      transaction.get(inviteCounterReference),
      transaction.get(
        db
          .collectionGroup("members")
          .where("uid", "==", input.user.uid)
          .where("status", "==", "active")
          .limit(1),
      ),
    ]);
    const league = leagueSnapshot.data();
    if (league === undefined || league.status !== "active") {
      throw new HttpsError("not-found", "Arena is unavailable.");
    }
    if (memberSnapshot.data()?.status === "active") {
      return {leagueId, newlyJoined: false};
    }
    const inviteCounter = inviteCounterSnapshot.data();
    const counterHash = inviteId === null
      ? inviteCounter?.inviteCodeHash
      : inviteCounter?.codeHash;
    const counterExpiresAt = inviteCounter?.expiresAt;
    if (
      !inviteCounterSnapshot.exists ||
      inviteCounter?.active !== true ||
      counterHash !== codeHash ||
      (counterExpiresAt instanceof Timestamp &&
        counterExpiresAt.toMillis() <= Date.now())
    ) {
      throw new HttpsError("not-found", "Invite code is invalid or expired.");
    }
    if (
      mapping.active !== true ||
      (expiresAt instanceof Timestamp && expiresAt.toMillis() <= Date.now()) ||
      (maxUses !== null && useCount >= maxUses)
    ) {
      throw new HttpsError("not-found", "Invite code is invalid or expired.");
    }
    if (!activeMemberships.empty) {
      throw new HttpsError(
        "already-exists",
        "You already belong to an active arena.",
      );
    }

    let eligibleFromWeekId: string | null = null;
    let eligibleFromSequentialNumber: number | null = null;
    if (typeof league.currentWeekId === "string") {
      const currentWeek = await transaction.get(
        leagueReference.collection("weeks").doc(league.currentWeekId),
      );
      if (currentWeek.data()?.status === "draft") {
        eligibleFromWeekId = currentWeek.id;
      } else {
        eligibleFromSequentialNumber =
          Number(currentWeek.data()?.sequentialNumber ?? 0) + 1;
      }
    }
    const currentMaximum =
      orderedMembers.empty
        ? -1
        : Number(orderedMembers.docs[0]?.data().rotationOrder ?? -1);
    transaction.set(memberReference, {
      uid: input.user.uid,
      displayName: input.nickname ?? input.user.displayName,
      photoUrl: input.user.photoUrl,
      role: "member",
      status: "active",
      rotationOrder: currentMaximum + 1,
      joinedAt:
        memberSnapshot.data()?.joinedAt ?? FieldValue.serverTimestamp(),
      eligibleFromWeekId,
      eligibleFromSequentialNumber,
      lastActiveAt: FieldValue.serverTimestamp(),
    });
    transaction.update(mappingReference, {
      useCount: useCount + 1,
      lastUsedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(inviteCounterReference, {
      useCount: useCount + 1,
      lastUsedAt: FieldValue.serverTimestamp(),
    });
    writeAuditInTransaction(transaction, {
      leagueId,
      eventType: "member_joined",
      actorUid: input.user.uid,
      target: `members/${input.user.uid}`,
      requestId: input.requestId,
      after: {role: "member", status: "active"},
    });
    return {leagueId, newlyJoined: true};
  });
  return {leagueId: result.leagueId};
}

export async function leaveLeagueRecord(input: {
  leagueId: string;
  actorUid: string;
  requestId: string;
}): Promise<void> {
  const member = await requireMembership(input.leagueId, input.actorUid);
  if (member.role === "owner") {
    throw new HttpsError(
      "failed-precondition",
      "Owners cannot leave an active arena. Ownership transfer is not "
        + "available in this release.",
    );
  }
  const reference = db
    .collection("leagues")
    .doc(input.leagueId)
    .collection("members")
    .doc(input.actorUid);
  await reference.update({
    status: "inactive",
    leftAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAudit({
    leagueId: input.leagueId,
    eventType: "member_left",
    actorUid: input.actorUid,
    target: `members/${input.actorUid}`,
    requestId: input.requestId,
    after: {status: "inactive"},
  });
}

export async function rotateInvite(input: {
  leagueId: string;
  actorUid: string;
  requestId: string;
  expiresAt: Date | null;
  maxUses: number | null;
}): Promise<{inviteCode: string}> {
  await requireOwner(input.leagueId, input.actorUid);
  const code = createInviteCode();
  const codeHash = opaqueHash(code, getInvitePepper());
  const references = inviteReferences(codeHash, input.leagueId);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(references.config);
    const oldHash = current.data()?.inviteCodeHash;
    if (typeof oldHash === "string") {
      transaction.set(
        db.collection("joinCodeMappings").doc(oldHash),
        {
          active: false,
          revokedAt: FieldValue.serverTimestamp(),
          revokedBy: input.actorUid,
        },
        {merge: true},
      );
    }
    transaction.set(references.config, {
      inviteCodeHash: codeHash,
      generatedAt: FieldValue.serverTimestamp(),
      generatedBy: input.actorUid,
      expiresAt:
        input.expiresAt === null ? null : Timestamp.fromDate(input.expiresAt),
      maxUses: input.maxUses,
      useCount: 0,
      active: true,
    });
    transaction.create(references.mapping, {
      leagueId: input.leagueId,
      active: true,
      expiresAt:
        input.expiresAt === null ? null : Timestamp.fromDate(input.expiresAt),
      maxUses: input.maxUses,
      useCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
    writeAuditInTransaction(transaction, {
      leagueId: input.leagueId,
      eventType: "invite_rotated",
      actorUid: input.actorUid,
      target: "private/invite",
      requestId: input.requestId,
      after: {
        expiresAt: input.expiresAt?.toISOString() ?? null,
        maxUses: input.maxUses,
      },
    });
  });
  return {inviteCode: code};
}

export async function issueArenaInviteRecord(input: {
  leagueId: string;
  actorUid: string;
  requestId: string;
  expiresAt?: Date;
  maxUses: number;
  codeFormatVersion: ArenaInviteCodeFormatVersion;
}): Promise<{
  inviteId: string;
  inviteCode: string;
  expiresAt: string;
  maxUses: number;
}> {
  await requireOwner(input.leagueId, input.actorUid);
  const pepper = getInvitePepper();
  const identity = {
    leagueId: input.leagueId,
    actorUid: input.actorUid,
    requestId: input.requestId,
  };
  const inviteId = arenaInviteIdForRequest(identity);
  const candidateCount = input.codeFormatVersion === 1
    ? 1
    : SHORT_ARENA_INVITE_CANDIDATE_COUNT;
  const candidates = Array.from({length: candidateCount}, (_, index) => {
    const inviteCode = arenaInviteCodeForRequest(
      identity,
      pepper,
      input.codeFormatVersion,
      index,
    );
    const codeHash = opaqueHash(inviteCode, pepper);
    return {
      inviteCode,
      codeHash,
      derivationIndex: index,
      references: independentInviteReferences({
        codeHash,
        leagueId: input.leagueId,
        inviteId,
      }),
    };
  });
  const metadataReference = candidates[0]?.references.metadata;
  if (metadataReference === undefined) {
    throw new HttpsError("internal", "Invite generation is unavailable.");
  }
  const requestedExpiresAt = input.expiresAt;
  const legacyConfigReference = db
    .collection("leagues")
    .doc(input.leagueId)
    .collection("private")
    .doc("invite");

  const result = await db.runTransaction(async (transaction) => {
    const [metadataSnapshot, legacyConfigSnapshot, ...mappingSnapshots] =
      await Promise.all([
        transaction.get(metadataReference),
        transaction.get(legacyConfigReference),
        ...candidates.map(async (candidate) =>
          transaction.get(candidate.references.mapping)),
      ]);
    const metadata = metadataSnapshot.data();
    const storedCodeFormatVersion = metadata?.codeFormatVersion ?? 1;
    const storedDerivationIndex = metadata?.derivationIndex ?? 0;
    const candidateIndex = metadata === undefined
      ? mappingSnapshots.findIndex((snapshot) => !snapshot.exists)
      : storedCodeFormatVersion === input.codeFormatVersion &&
          Number.isInteger(storedDerivationIndex) &&
          storedDerivationIndex >= 0 &&
          storedDerivationIndex < candidates.length
        ? Number(storedDerivationIndex)
        : -1;
    if (candidateIndex < 0) {
      throw new HttpsError(
        "failed-precondition",
        "This invite request conflicts with an existing invite.",
      );
    }
    const candidate = candidates[candidateIndex];
    const mappingSnapshot = mappingSnapshots[candidateIndex];
    if (candidate === undefined || mappingSnapshot === undefined) {
      throw new HttpsError("internal", "Invite generation is unavailable.");
    }
    const {codeHash, derivationIndex, inviteCode, references} = candidate;
    const legacyConfig = legacyConfigSnapshot.data();
    const legacyCodeHash = legacyConfig?.inviteCodeHash;
    const legacyMappingReference = typeof legacyCodeHash === "string"
      ? db.collection("joinCodeMappings").doc(legacyCodeHash)
      : null;
    const legacyMappingSnapshot = legacyMappingReference === null
      ? null
      : await transaction.get(legacyMappingReference);
    const retireLegacyInvite = (): void => {
      if (legacyConfig?.active !== true) return;
      if (
        legacyMappingReference === null ||
        legacyMappingSnapshot === null ||
        !legacyMappingSnapshot.exists ||
        legacyMappingSnapshot.data()?.leagueId !== input.leagueId
      ) {
        throw new HttpsError(
          "failed-precondition",
          "The existing arena invite could not be retired safely.",
        );
      }
      const retirement = {
        active: false,
        retiredAt: FieldValue.serverTimestamp(),
        retiredBy: input.actorUid,
        retiredRequestId: input.requestId,
      };
      transaction.update(legacyConfigReference, retirement);
      transaction.update(legacyMappingReference, retirement);
    };
    if (metadata !== undefined) {
      const storedExpiresAt = metadata.expiresAt;
      const mappedCodeFormatVersion =
        mappingSnapshot.data()?.codeFormatVersion ?? 1;
      if (
        metadata.inviteId !== inviteId ||
        metadata.codeHash !== codeHash ||
        storedCodeFormatVersion !== input.codeFormatVersion ||
        storedDerivationIndex !== derivationIndex ||
        metadata.createdBy !== input.actorUid ||
        metadata.issuanceRequestId !== input.requestId ||
        !(storedExpiresAt instanceof Timestamp) ||
        metadata.maxUses !== input.maxUses ||
        !mappingSnapshot.exists ||
        mappingSnapshot.data()?.leagueId !== input.leagueId ||
        mappingSnapshot.data()?.inviteId !== inviteId ||
        mappedCodeFormatVersion !== input.codeFormatVersion
      ) {
        throw new HttpsError(
          "failed-precondition",
          "This invite request conflicts with an existing invite.",
        );
      }
      if (
        requestedExpiresAt !== undefined &&
        storedExpiresAt.toMillis() !== requestedExpiresAt.valueOf()
      ) {
        throw new HttpsError(
          "failed-precondition",
          "This invite request conflicts with an existing invite.",
        );
      }
      retireLegacyInvite();
      return {
        inviteCode,
        expiresAt: storedExpiresAt.toDate(),
        maxUses: Number(metadata.maxUses),
      };
    }

    const expiresAt = requestedExpiresAt ??
      new Date(Date.now() + DEFAULT_ARENA_INVITE_LIFETIME_MS);
    if (expiresAt.valueOf() <= Date.now()) {
      throw new HttpsError(
        "invalid-argument",
        "Invite expiration must be in the future.",
      );
    }
    const expiresAtTimestamp = Timestamp.fromDate(expiresAt);
    retireLegacyInvite();
    transaction.create(references.metadata, {
      inviteId,
      codeHash,
      codeFormatVersion: input.codeFormatVersion,
      derivationIndex,
      inviteKind: "independent",
      active: true,
      expiresAt: expiresAtTimestamp,
      maxUses: input.maxUses,
      useCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: input.actorUid,
      issuanceRequestId: input.requestId,
    });
    transaction.create(references.mapping, {
      leagueId: input.leagueId,
      inviteId,
      codeFormatVersion: input.codeFormatVersion,
      derivationIndex,
      inviteKind: "independent",
      active: true,
      expiresAt: expiresAtTimestamp,
      maxUses: input.maxUses,
      useCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: input.actorUid,
    });
    writeAuditInTransaction(transaction, {
      leagueId: input.leagueId,
      eventType: "invite_issued",
      actorUid: input.actorUid,
      target: `privateInvites/${inviteId}`,
      requestId: input.requestId,
      after: {
        inviteId,
        codeFormatVersion: input.codeFormatVersion,
        derivationIndex,
        expiresAt: expiresAt.toISOString(),
        maxUses: input.maxUses,
        legacyInviteRetired: legacyConfig?.active === true,
      },
    });
    return {inviteCode, expiresAt, maxUses: input.maxUses};
  });

  return {
    inviteId,
    inviteCode: result.inviteCode,
    expiresAt: result.expiresAt.toISOString(),
    maxUses: result.maxUses,
  };
}

export async function revokeArenaInviteRecord(input: {
  leagueId: string;
  actorUid: string;
  requestId: string;
  inviteId: string;
}): Promise<{inviteId: string; revoked: true}> {
  await requireOwner(input.leagueId, input.actorUid);
  const metadataReference = db
    .collection("leagues")
    .doc(input.leagueId)
    .collection("privateInvites")
    .doc(input.inviteId);
  await db.runTransaction(async (transaction) => {
    const metadataSnapshot = await transaction.get(metadataReference);
    const metadata = metadataSnapshot.data();
    if (!metadataSnapshot.exists || metadata?.inviteKind !== "independent") {
      throw new HttpsError("not-found", "Invite not found.");
    }
    const codeHash = metadata.codeHash;
    if (typeof codeHash !== "string") {
      throw new HttpsError(
        "failed-precondition",
        "Invite metadata is invalid.",
      );
    }
    const mappingReference = db.collection("joinCodeMappings").doc(codeHash);
    const mappingSnapshot = await transaction.get(mappingReference);
    const mapping = mappingSnapshot.data();
    if (metadata.active !== true) {
      if (mappingSnapshot.exists && mapping?.active === true) {
        transaction.update(mappingReference, {
          active: false,
          revokedAt: FieldValue.serverTimestamp(),
          revokedBy: input.actorUid,
          revokedRequestId: input.requestId,
        });
      }
      return;
    }
    if (
      !mappingSnapshot.exists ||
      mapping?.leagueId !== input.leagueId ||
      mapping.inviteId !== input.inviteId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Invite metadata is invalid.",
      );
    }
    const purgeAt = Timestamp.fromMillis(
      Date.now() + REVOKED_INVITE_RETENTION_MS,
    );
    transaction.update(metadataReference, {
      active: false,
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: input.actorUid,
      revokedRequestId: input.requestId,
      purgeAt,
    });
    transaction.update(mappingReference, {
      active: false,
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: input.actorUid,
      revokedRequestId: input.requestId,
      purgeAt,
    });
    writeAuditInTransaction(transaction, {
      leagueId: input.leagueId,
      eventType: "invite_revoked",
      actorUid: input.actorUid,
      target: `privateInvites/${input.inviteId}`,
      requestId: input.requestId,
      after: {inviteId: input.inviteId, active: false},
    });
  });
  return {inviteId: input.inviteId, revoked: true};
}

export async function updateSettings(input: {
  leagueId: string;
  actorUid: string;
  requestId: string;
  settings: Partial<LeagueSettings>;
}): Promise<void> {
  await requireOwner(input.leagueId, input.actorUid);
  if (input.settings.providerName !== undefined) {
    // Resolve the provider before committing the setting so a runtime flag
    // cannot strand an arena whose catalog activation is still incomplete.
    await getProvider(input.settings.providerName);
  }
  for (const provider of Object.values(input.settings.providerBySport ?? {})) {
    await getProvider(provider);
  }
  const reference = db.collection("leagues").doc(input.leagueId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const previous = snapshot.data()?.settings ?? {};
    transaction.update(reference, {
      settings: {...previous, ...input.settings},
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAuditInTransaction(transaction, {
      leagueId: input.leagueId,
      eventType: "league_settings_updated",
      actorUid: input.actorUid,
      target: `leagues/${input.leagueId}`,
      requestId: input.requestId,
      before: previous,
      after: {...previous, ...input.settings},
    });
  });
}

export async function updateMember(input: {
  leagueId: string;
  actorUid: string;
  requestId: string;
  memberUid: string;
  role?: MemberRole;
  status?: "active" | "inactive" | "removed";
}): Promise<void> {
  const actor = await requireAdmin(input.leagueId, input.actorUid);
  const reference = db
    .collection("leagues")
    .doc(input.leagueId)
    .collection("members")
    .doc(input.memberUid);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.data();
    if (current === undefined) {
      throw new HttpsError("not-found", "Member not found.");
    }
    if (current.role === "owner") {
      throw new HttpsError(
        "failed-precondition",
        "Ownership cannot be changed through this action.",
      );
    }
    if (
      actor.role !== "owner" &&
      (input.role !== undefined || current.role === "commissioner")
    ) {
      throw new HttpsError(
        "permission-denied",
        "Only the owner can manage commissioner roles.",
      );
    }
    if (input.role === "owner") {
      throw new HttpsError(
        "failed-precondition",
        "Ownership transfer is not supported in this MVP.",
      );
    }
    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (input.role !== undefined) updates.role = input.role;
    if (input.status !== undefined) updates.status = input.status;
    transaction.update(reference, updates);
    writeAuditInTransaction(transaction, {
      leagueId: input.leagueId,
      eventType: "member_updated",
      actorUid: input.actorUid,
      target: `members/${input.memberUid}`,
      requestId: input.requestId,
      before: {role: current.role, status: current.status},
      after: {
        role: input.role ?? current.role,
        status: input.status ?? current.status,
      },
    });
  });
}

export async function reorderRotation(input: {
  leagueId: string;
  actorUid: string;
  requestId: string;
  orderedMemberUids: string[];
}): Promise<void> {
  await requireAdmin(input.leagueId, input.actorUid);
  const unique = new Set(input.orderedMemberUids);
  if (unique.size !== input.orderedMemberUids.length) {
    throw new HttpsError("invalid-argument", "Rotation contains duplicates.");
  }
  const collection = db
    .collection("leagues")
    .doc(input.leagueId)
    .collection("members");
  const active = await collection.where("status", "==", "active").get();
  const activeIds = new Set(active.docs.map((member) => member.id));
  if (
    activeIds.size !== unique.size ||
    [...activeIds].some((uid) => !unique.has(uid))
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Rotation must include every active member exactly once.",
    );
  }
  await commitWritesInChunks(
    db,
    input.orderedMemberUids.map((uid, rotationOrder) => ({uid, rotationOrder})),
    (batch, item) => {
      batch.update(collection.doc(item.uid), {
        rotationOrder: item.rotationOrder,
        updatedAt: FieldValue.serverTimestamp(),
      });
    },
  );
  await writeAudit({
    leagueId: input.leagueId,
    eventType: "rotation_reordered",
    actorUid: input.actorUid,
    target: "members/rotation",
    requestId: input.requestId,
    after: {orderedMemberUids: input.orderedMemberUids},
  });
}

export async function anonymizeAccount(input: {
  user: AuthenticatedUser;
  requestId: string;
}): Promise<void> {
  const memberships = await db
    .collectionGroup("members")
    .where("uid", "==", input.user.uid)
    .get();
  if (
    memberships.docs.some(
      (member) =>
        member.data().role === "owner" && member.data().status === "active",
    )
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Owners of active arenas cannot delete their account. Ownership "
        + "transfer is not available in this release.",
    );
  }
  const alias = `Former member ${sha256(input.user.uid).slice(0, 6).toUpperCase()}`;
  // Resolve every collection-group query before applying any anonymization
  // writes. A missing production index must fail without leaving a partially
  // anonymized account.
  const [reveals, pickerWeeks] = await Promise.all([
    db
      .collectionGroup("picks")
      .where("uid", "==", input.user.uid)
      .get(),
    db
      .collectionGroup("weeks")
      .where("pickerUid", "==", input.user.uid)
      .get(),
  ]);
  await commitWritesInChunks(db, memberships.docs, (batch, member) => {
    batch.set(
      member.ref,
      {
        displayName: alias,
        photoUrl: null,
        status: "inactive",
        accountDeleted: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
  });
  await commitWritesInChunks(db, reveals.docs, (batch, reveal) => {
    batch.set(
      reveal.ref,
      {displayName: alias, photoUrl: null},
      {merge: true},
    );
  });
  await commitWritesInChunks(db, pickerWeeks.docs, (batch, week) => {
    batch.set(
      week.ref,
      {pickerDisplayNameSnapshot: alias},
      {merge: true},
    );
  });
  await db.collection("users").doc(input.user.uid).set(
    {
      uid: input.user.uid,
      email: null,
      displayName: alias,
      photoUrl: null,
      accountStatus: "deleted",
      deletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: false},
  );
  try {
    await auth.deleteUser(input.user.uid);
  } catch (error: unknown) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("no user record")
    ) {
      throw error;
    }
  }
}
