import type {CatalogPresentation} from "../types.js";

export function neutralCatalogPresentation(
  provider: string,
  attributionText: string | null = null,
): CatalogPresentation {
  return {
    provider,
    attributionText,
    allowRemoteLogos: false,
    allowedLogoHosts: [],
    allowedLogoQueryParameters: [],
    logoRightsReviewDate: null,
  };
}
