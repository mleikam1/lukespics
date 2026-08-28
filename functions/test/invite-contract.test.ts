import {describe, expect, it} from "vitest";
import {
  issueArenaInviteSchema,
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
  it("derives a stable 144-bit URL-safe code without embedding identifiers", () => {
    const code = arenaInviteCodeForRequest(identity, pepper);

    expect(code).toHaveLength(24);
    expect(code).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(code).toBe(arenaInviteCodeForRequest(identity, pepper));
    expect(code).not.toContain(identity.leagueId);
    expect(code).not.toContain(identity.actorUid);
    expect(code).not.toContain(identity.requestId);
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
});
