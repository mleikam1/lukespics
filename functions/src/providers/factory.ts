import {db} from "../config.js";
import type {SportsDataProvider} from "../types.js";
import {ApiSportsProvider, parseApiSportsConfigs} from "./apiSports.js";
import {ManualSportsProvider} from "./manual.js";
import {MockSportsProvider} from "./mock.js";

export async function getProvider(
  name: "mock" | "manual" | "apiSports",
): Promise<SportsDataProvider> {
  if (name === "mock") return new MockSportsProvider();
  if (name === "manual") return new ManualSportsProvider();

  const catalog = await db
    .collection("systemConfig")
    .doc("apiSportsCatalog")
    .get();
  const configs = parseApiSportsConfigs(catalog.data()?.leagues ?? []);
  return new ApiSportsProvider(configs);
}
