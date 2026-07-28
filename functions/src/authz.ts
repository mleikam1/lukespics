import type {CallableRequest} from "firebase-functions/v2/https";
import {HttpsError} from "firebase-functions/v2/https";
import {db} from "./config.js";
import type {MemberRole} from "./types.js";

export type AuthenticatedUser = {
  uid: string;
  displayName: string;
  photoUrl: string | null;
  email: string | null;
};

export function requireUser(request: CallableRequest): AuthenticatedUser {
  const auth = request.auth;
  if (auth === undefined) {
    throw new HttpsError("unauthenticated", "Sign in to continue.");
  }

  const displayName =
    typeof auth.token.name === "string" && auth.token.name.trim().length > 0
      ? auth.token.name.trim().slice(0, 80)
      : "Member";
  const photoUrl =
    typeof auth.token.picture === "string" ? auth.token.picture : null;
  const email = typeof auth.token.email === "string" ? auth.token.email : null;

  return {uid: auth.uid, displayName, photoUrl, email};
}

export type Membership = {
  uid: string;
  role: MemberRole;
  status: string;
  displayName: string;
  photoUrl: string | null;
  rotationOrder: number;
};

export async function requireMembership(
  leagueId: string,
  uid: string,
): Promise<Membership> {
  const snapshot = await db
    .collection("leagues")
    .doc(leagueId)
    .collection("members")
    .doc(uid)
    .get();
  const data = snapshot.data();
  if (
    !snapshot.exists ||
    data?.status !== "active" ||
    !["owner", "commissioner", "member"].includes(String(data.role))
  ) {
    throw new HttpsError(
      "permission-denied",
      "You are not an active member of this arena.",
    );
  }

  return {
    uid,
    role: data.role as MemberRole,
    status: String(data.status),
    displayName:
      typeof data.displayName === "string" ? data.displayName : "Member",
    photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : null,
    rotationOrder:
      typeof data.rotationOrder === "number" ? data.rotationOrder : 0,
  };
}

export async function requireAdmin(
  leagueId: string,
  uid: string,
): Promise<Membership> {
  const member = await requireMembership(leagueId, uid);
  if (member.role !== "owner" && member.role !== "commissioner") {
    throw new HttpsError(
      "permission-denied",
      "Commissioner access is required.",
    );
  }
  return member;
}

export async function requireOwner(
  leagueId: string,
  uid: string,
): Promise<Membership> {
  const member = await requireMembership(leagueId, uid);
  if (member.role !== "owner") {
    throw new HttpsError("permission-denied", "Owner access is required.");
  }
  return member;
}

export async function requirePickerOrAdmin(
  leagueId: string,
  weekId: string,
  uid: string,
): Promise<{member: Membership; week: FirebaseFirestore.DocumentData}> {
  const [member, weekSnapshot] = await Promise.all([
    requireMembership(leagueId, uid),
    db
      .collection("leagues")
      .doc(leagueId)
      .collection("weeks")
      .doc(weekId)
      .get(),
  ]);
  const week = weekSnapshot.data();
  if (!weekSnapshot.exists || week === undefined) {
    throw new HttpsError("not-found", "Week not found.");
  }
  if (
    member.role !== "owner" &&
    member.role !== "commissioner" &&
    week.pickerUid !== uid
  ) {
    throw new HttpsError(
      "permission-denied",
      "Only this week's picker may manage the draft slate.",
    );
  }
  return {member, week};
}
