import {describe, expect, it} from "vitest";
import {submitEntrySchema} from "../src/schemas.js";

const baseRequest = {
  requestId: "entry-schema-request",
  leagueId: "league-1",
  weekId: "week-0001",
};

describe("pick entry schema", () => {
  it("accepts a normal pick batch and bounds transactional work", () => {
    expect(
      submitEntrySchema.safeParse({
        ...baseRequest,
        picks: [{gameId: "game-1", selectedTeamId: "team-1"}],
      }).success,
    ).toBe(true);

    expect(
      submitEntrySchema.safeParse({
        ...baseRequest,
        picks: Array.from({length: 101}, (_value, index) => ({
          gameId: `game-${index}`,
          selectedTeamId: `team-${index}`,
        })),
      }).success,
    ).toBe(false);
  });
});
