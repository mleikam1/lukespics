import {describe, expect, it} from "vitest";
import {isProviderAllowed, providerRuntime} from "../src/providers/policy.js";
import {
  collegeFootballAdminRefreshSchema,
  collegeFootballScheduleSchema,
  leagueSettingsSchema,
} from "../src/schemas.js";
import {providerQueryCacheIdentity} from "../src/services/providerGateway.js";
import {
  assertCbsCollegeFootballActiveIdentity,
  parseCbsCollegeFootballConfig,
} from "../src/services/cbsCollegeFootballSchedule.js";
import {withCbsProviderForNewLeague} from "../src/services/leagues.js";
import {
  assertSingleConnectedSlateProvider,
  assertCurrentWeekProviderAccess,
  catalogProviderNamesForQuery,
  catalogGameDateInTimezone,
  configuredProviderForSport,
} from "../src/services/weeks.js";
import {CbsCollegeFootballProvider} from
  "../src/providers/cbsCollegeFootballProvider.js";
import type {ProviderQuery} from "../src/types.js";

describe("CBS college-football integration contracts", () => {
  it("adds the server-enabled CBS mapping to every new arena", () => {
    const settings = withCbsProviderForNewLeague({
      providerName: "manual",
      providerBySport: {
        baseball: "manual",
        NCAAF: "manual",
      },
    }, true);

    expect(settings).toEqual({
      providerName: "manual",
      providerBySport: {
        baseball: "manual",
        NCAAF: "cbsSports",
      },
    });
  });

  it("does not add the CBS mapping while its server kill switch is off", () => {
    const settings = withCbsProviderForNewLeague({
      providerName: "manual",
      providerBySport: {baseball: "manual"},
    }, false);

    expect(settings).toEqual({
      providerName: "manual",
      providerBySport: {baseball: "manual"},
    });
  });

  it("supports a per-sport CBS provider without changing the default provider", () => {
    const settings = leagueSettingsSchema.parse({
      providerName: "sportsDataIo",
      providerBySport: {NCAAF: "cbsSports"},
    });

    expect(settings.providerName).toBe("sportsDataIo");
    expect(settings.providerBySport).toEqual({NCAAF: "cbsSports"});
  });

  it("allows CBS only in the exact production project and approved local emulator", () => {
    const production = providerRuntime({GCLOUD_PROJECT: "lukes-picks"});
    const approvedLocal = providerRuntime({
      GCLOUD_PROJECT: "demo-lukes-picks-local",
      FUNCTIONS_EMULATOR: "true",
    });
    const otherProduction = providerRuntime({GCLOUD_PROJECT: "other-project"});
    const otherLocal = providerRuntime({
      GCLOUD_PROJECT: "other-project",
      FUNCTIONS_EMULATOR: "true",
    });
    const productionProjectInEmulator = providerRuntime({
      GCLOUD_PROJECT: "lukes-picks",
      FUNCTIONS_EMULATOR: "true",
    });

    expect(isProviderAllowed("cbsSports", production)).toBe(true);
    expect(isProviderAllowed("cbsSports", approvedLocal)).toBe(true);
    expect(isProviderAllowed("cbsSports", otherProduction)).toBe(false);
    expect(isProviderAllowed("cbsSports", otherLocal)).toBe(false);
    expect(isProviderAllowed("cbsSports", productionProjectInEmulator)).toBe(
      false,
    );
  });

  it("maps NCAAF to CBS while retaining the default for other sports", () => {
    const settings = {
      providerName: "sportsDataIo" as const,
      providerBySport: {NCAAF: "cbsSports" as const},
    };

    expect(configuredProviderForSport(settings, "NCAAF")).toBe("cbsSports");
    expect(configuredProviderForSport(settings, "baseball")).toBe(
      "sportsDataIo",
    );
    expect(catalogProviderNamesForQuery(settings, {
      sportCode: "NCAAF",
    })).toEqual(["cbsSports"]);
    expect(catalogProviderNamesForQuery(settings, {})).toEqual([
      "sportsDataIo",
      "cbsSports",
    ]);
  });

  it("enables only the reviewed CBS scoreboard logo hosts", () => {
    const presentation = new CbsCollegeFootballProvider().presentation;

    expect(presentation).toMatchObject({
      provider: "cbsSports",
      allowRemoteLogos: true,
      logoRightsReviewDate: "2026-08-25",
    });
    expect(presentation.allowedLogoHosts).toEqual([
      "sports.cbsimg.net",
      "sportshub.cbsistatic.com",
    ]);
    expect(presentation.allowedLogoQueryParameters).toEqual([]);
  });

  it("rejects mixed connected providers before a draft can be saved", () => {
    expect(() => assertSingleConnectedSlateProvider([
      {provider: "cbsSports"},
      {provider: "manual"},
      {provider: "cbsSports"},
    ])).not.toThrow();
    expect(() => assertSingleConnectedSlateProvider([
      {provider: "cbsSports"},
      {provider: "sportsDataIo"},
    ])).toThrow(/only one connected sports provider/i);
  });

  it("keys CBS caches by scoreboard week rather than date-window presentation", () => {
    const base: ProviderQuery = {
      sportCode: "NCAAF",
      leagueCode: "ncaaf",
      providerLeagueId: "FBS",
      season: "2030",
      seasonType: "regular",
      week: 1,
      division: "FBS",
      from: "2030-08-24",
      to: "2030-08-31",
      timezone: "America/Chicago",
    };
    const identity = providerQueryCacheIdentity("cbsSports", base);
    const presentationVariant = providerQueryCacheIdentity("cbsSports", {
      ...base,
      from: "2030-09-01",
      to: "2030-09-07",
      timezone: "Pacific/Honolulu",
    });
    const nextWeek = providerQueryCacheIdentity("cbsSports", {
      ...base,
      week: 2,
    });
    const postseason = providerQueryCacheIdentity("cbsSports", {
      ...base,
      seasonType: "postseason",
    });

    expect(presentationVariant).toEqual(identity);
    expect(nextWeek).not.toEqual(identity);
    expect(postseason).not.toEqual(identity);
  });

  it("filters confirmed CBS kickoffs by arena date, not Eastern source date", () => {
    expect(catalogGameDateInTimezone({
      scheduledAtUtc: new Date("2030-08-31T04:30:00.000Z"),
      scheduledDayEastern: "2030-08-31",
    }, "America/Chicago")).toBe("2030-08-30");
    expect(catalogGameDateInTimezone({
      scheduledAtUtc: null,
      scheduledDayEastern: "2030-08-31",
    }, "America/Chicago")).toBe("2030-08-31");
  });

  it("rejects arbitrary URL fields from both college-football callables", () => {
    const schedule = {
      requestId: "request-cbs-schedule",
      leagueId: "league-cbs-contract",
      season: 2030,
      seasonType: "regular" as const,
      week: 1,
      division: "FBS" as const,
    };
    const refresh = {
      ...schedule,
      weekId: "week-cbs-contract",
      reason: "Contract test refresh",
    };

    expect(collegeFootballScheduleSchema.safeParse(schedule).success).toBe(
      true,
    );
    expect(
      collegeFootballScheduleSchema.safeParse({
        ...schedule,
        url: "https://attacker.example.test/arbitrary",
      }).success,
    ).toBe(false);
    expect(
      collegeFootballScheduleSchema.safeParse({
        ...schedule,
        sourceUrl:
          "https://www.cbssports.com/college-football/scoreboard/FBS/2030/regular/1/",
      }).success,
    ).toBe(false);
    expect(collegeFootballAdminRefreshSchema.safeParse(refresh).success).toBe(
      true,
    );
    expect(
      collegeFootballAdminRefreshSchema.safeParse({
        ...refresh,
        hostname: "www.cbssports.com",
      }).success,
    ).toBe(false);
  });

  it("binds direct schedule reads and refreshes to one configured active week", () => {
    const config = parseCbsCollegeFootballConfig({
      enabled: false,
      activeSeason: 2030,
      activeSeasonType: "regular",
      activeWeek: 1,
      division: "FBS",
    });
    const active = {
      season: 2030,
      seasonType: "regular" as const,
      week: 1,
      division: "FBS" as const,
    };

    expect(assertCbsCollegeFootballActiveIdentity(config, active)).toEqual(
      active,
    );
    expect(() => assertCbsCollegeFootballActiveIdentity(config, {
      ...active,
      week: 2,
    })).toThrow(/configured active week/i);
    expect(() => assertCbsCollegeFootballActiveIdentity(config, {
      ...active,
      seasonType: "postseason",
    })).toThrow(/configured active week/i);
  });

  it("allows only the current picker or an arena administrator to spend refresh capacity", () => {
    expect(() => assertCurrentWeekProviderAccess({
      role: "member",
      currentWeekId: "week-current",
      requestedWeekId: "week-current",
    })).not.toThrow();
    expect(() => assertCurrentWeekProviderAccess({
      role: "owner",
      currentWeekId: "week-current",
      requestedWeekId: "week-old",
    })).not.toThrow();
    expect(() => assertCurrentWeekProviderAccess({
      role: "member",
      currentWeekId: "week-current",
      requestedWeekId: "week-old",
    })).toThrow(/current week's picker/i);
  });
});
