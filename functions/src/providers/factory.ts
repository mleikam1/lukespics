import {db} from "../config.js";
import type {ProviderName, SportsDataProvider} from "../types.js";
import {ApiSportsProvider, parseApiSportsCatalog} from "./apiSports.js";
import {ManualSportsProvider} from "./manual.js";
import {MockSportsProvider} from "./mock.js";
import {assertProviderAllowedForRuntime} from "./policy.js";
import {
  parseTheSportsDbTestConfigs,
  TheSportsDbTestProvider,
} from "./theSportsDbTest.js";

export async function getProvider(
  name: ProviderName,
): Promise<SportsDataProvider> {
  assertProviderAllowedForRuntime(name);
  if (name === "mock") return new MockSportsProvider();
  if (name === "manual") return new ManualSportsProvider();
  if (name === "theSportsDbTest") {
    const catalog = await db
      .collection("systemConfig")
      .doc("theSportsDbTestCatalog")
      .get();
    const configs = parseTheSportsDbTestConfigs(
      catalog.data()?.leagues ?? [],
    );
    return new TheSportsDbTestProvider(configs);
  }

  const catalog = await db
    .collection("systemConfig")
    .doc("apiSportsCatalog")
    .get();
  const parsed = parseApiSportsCatalog(catalog.data() ?? {leagues: []});
  return new ApiSportsProvider(parsed.leagues, parsed.presentation);
}
