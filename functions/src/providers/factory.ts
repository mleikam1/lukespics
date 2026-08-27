import {HttpsError} from "firebase-functions/v2/https";
import {db} from "../config.js";
import type {ProviderName, SportsDataProvider} from "../types.js";
import {ApiSportsProvider, parseApiSportsCatalog} from "./apiSports.js";
import {CbsCollegeFootballProvider} from "./cbsCollegeFootballProvider.js";
import {ManualSportsProvider} from "./manual.js";
import {MockSportsProvider} from "./mock.js";
import {assertProviderAllowedForRuntime} from "./policy.js";
import {
  parseSportsDataIoCatalog,
  SportsDataIoProvider,
} from "./sportsDataIo.js";
import {
  parseTheSportsDbTestConfigs,
  TheSportsDbTestProvider,
} from "./theSportsDbTest.js";
import {parseCbsCollegeFootballConfig} from
  "../services/cbsCollegeFootballSchedule.js";

export async function getProvider(
  name: ProviderName,
): Promise<SportsDataProvider> {
  assertProviderAllowedForRuntime(name);
  switch (name) {
  case "mock":
    return new MockSportsProvider();
  case "manual":
    return new ManualSportsProvider();
  case "cbsSports": {
    const configuration = await db
      .collection("systemConfig")
      .doc("cbsCollegeFootball")
      .get();
    return new CbsCollegeFootballProvider(
      parseCbsCollegeFootballConfig(configuration.data() ?? {}),
    );
  }
  case "theSportsDbTest": {
    const catalog = await db
      .collection("systemConfig")
      .doc("theSportsDbTestCatalog")
      .get();
    const configs = parseTheSportsDbTestConfigs(
      catalog.data()?.leagues ?? [],
    );
    return new TheSportsDbTestProvider(configs);
  }
  case "sportsDataIo": {
    const catalog = await db
      .collection("systemConfig")
      .doc("sportsDataIoCatalog")
      .get();
    const parsed = parseSportsDataIoCatalog(catalog.data() ?? {});
    if (!parsed.enabled) {
      throw new HttpsError(
        "failed-precondition",
        "SportsDataIO provider activation is not enabled in server configuration.",
      );
    }
    return new SportsDataIoProvider(parsed);
  }
  case "apiSports": {
    const catalog = await db
      .collection("systemConfig")
      .doc("apiSportsCatalog")
      .get();
    const parsed = parseApiSportsCatalog(catalog.data() ?? {leagues: []});
    return new ApiSportsProvider(parsed.leagues, parsed.presentation);
  }
  }
}
