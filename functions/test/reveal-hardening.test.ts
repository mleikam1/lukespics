import {Timestamp} from "firebase-admin/firestore";
import {describe, expect, it} from "vitest";
import {revealLockedPicksSchema} from "../src/schemas.js";
import {
  isRevealClaimActive,
  MAX_REVEAL_PAGE_SIZE,
  revealPayloadReadsEnabled,
} from "../src/services/weeks.js";

describe("reveal hardening", () => {
  it("bounds callable reveal pages and provides a stable first-page default", () => {
    expect(
      revealLockedPicksSchema.parse({
        requestId: "reveal_request_0001",
        leagueId: "league-1",
        weekId: "week-0001",
      }),
    ).toMatchObject({
      revealCursor: null,
      revealPageSize: MAX_REVEAL_PAGE_SIZE,
    });
    expect(
      revealLockedPicksSchema.safeParse({
        requestId: "reveal_request_0002",
        leagueId: "league-1",
        weekId: "week-0001",
        revealPageSize: MAX_REVEAL_PAGE_SIZE + 1,
      }).success,
    ).toBe(false);
    expect(
      revealLockedPicksSchema.safeParse({
        requestId: "reveal_request_0003",
        leagueId: "league-1",
        weekId: "week-0001",
        revealCursor: {
          gameId: "game-1",
          afterUid: "member@example.com",
        },
      }).success,
    ).toBe(true);
  });

  it("treats a claim heartbeat as a bounded lease", () => {
    const now = Date.parse("2030-01-01T00:10:00.000Z");
    expect(
      isRevealClaimActive(
        {
          pickRevealClaimId: "active-claim",
          pickRevealHeartbeatAt: Timestamp.fromMillis(now - 60_000),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isRevealClaimActive(
        {
          pickRevealClaimId: "stale-claim",
          pickRevealHeartbeatAt: Timestamp.fromMillis(now - 5 * 60_000),
        },
        now,
      ),
    ).toBe(false);
  });

  it("lets the scheduler disable committed reveal payload reads", () => {
    expect(revealPayloadReadsEnabled(false)).toBe(false);
    expect(revealPayloadReadsEnabled(undefined)).toBe(true);
  });
});
