import {describe, expect, it} from "vitest";
import {
  issueArenaInviteSchema,
  joinLeagueSchema,
  revokeArenaInviteSchema,
} from "../src/schemas.js";
import {
  DEFAULT_ARENA_INVITE_MAX_USES,
  arenaInviteCodeForRequest,
  arenaInviteIdForRequest,
} from "../src/services/leagues.js";

const identity = {
  leagueId: "league-alpha",
  actorUid: "owner-alpha",
  requestId: "issue-request-0001",
};
const pepper = "unit-test-invite-pepper-at-least-32-characters";

describe("arena invite contract", () => {
  it("derives a stable human-safe 40-bit code without identifiers", () => {
    const code = arenaInviteCodeForRequest(identity, pepper);

    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(code).toBe(arenaInviteCodeForRequest(identity, pepper));
    expect(arenaInviteCodeForRequest(identity, pepper, 2, 1)).not.toBe(code);
    expect(code).not.toContain(identity.leagueId);
    expect(code).not.toContain(identity.actorUid);
    expect(code).not.toContain(identity.requestId);

    const legacyCode = arenaInviteCodeForRequest(identity, pepper, 1);
    expect(legacyCode).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(legacyCode).toBe("vsJfKiKISml2wmlJ2rEoALUS");
  });

  it("domain-separates codes and invite identifiers by their full identity", () => {
    const code = arenaInviteCodeForRequest(identity, pepper);
    const inviteId = arenaInviteIdForRequest(identity);

    expect(inviteId).toMatch(/^invite-[a-f0-9]{32}$/);
    expect(arenaInviteCodeForRequest({
      ...identity,
      requestId: "issue-request-0002",
    }, pepper)).not.toBe(code);
    expect(arenaInviteCodeForRequest({
      ...identity,
      actorUid: "owner-beta",
    }, pepper)).not.toBe(code);
    expect(arenaInviteCodeForRequest(identity, `${pepper}-rotated`)).not.toBe(
      code,
    );
    expect(arenaInviteIdForRequest({
      ...identity,
      leagueId: "league-beta",
    })).not.toBe(inviteId);
  });

  it("defaults issuance to fifty uses and validates revoke handles", () => {
    const issued = issueArenaInviteSchema.parse({
      requestId: "issue-request-0001",
      leagueId: "league-alpha",
    });
    expect(issued.maxUses).toBe(DEFAULT_ARENA_INVITE_MAX_USES);
    expect(issued.expiresAt).toBeUndefined();
    expect(issued.codeFormatVersion).toBeUndefined();

    const shortIssued = issueArenaInviteSchema.parse({
      requestId: "issue-request-0002",
      leagueId: "league-alpha",
      codeFormatVersion: 2,
    });
    expect(shortIssued.codeFormatVersion).toBe(2);

    expect(revokeArenaInviteSchema.parse({
      requestId: "revoke-request-0001",
      leagueId: "league-alpha",
      inviteId: "invite-0123456789abcdef0123456789abcdef",
    }).inviteId).toBe("invite-0123456789abcdef0123456789abcdef");
    expect(() => issueArenaInviteSchema.parse({
      requestId: "issue-request-0001",
      leagueId: "league-alpha",
      maxUses: 0,
    })).toThrow();
  });

  it("canonicalizes short codes and preserves legacy code case", () => {
    const short = joinLeagueSchema.parse({
      requestId: "join-request-0001",
      inviteCode: "k7m4px9r",
    });
    expect(short.inviteCode).toBe("K7M4PX9R");

    const legacyCode = "AbCdEfGhIjKlMnOpQrStUvWx";
    const legacy = joinLeagueSchema.parse({
      requestId: "join-request-0002",
      inviteCode: legacyCode,
    });
    expect(legacy.inviteCode).toBe(legacyCode);

    for (const invalid of ["ABC123", "ABCDEFGHI", "ABCD-234", "bad code!"]) {
      expect(() => joinLeagueSchema.parse({
        requestId: "join-request-invalid",
        inviteCode: invalid,
      })).toThrow();
    }
  });
});
