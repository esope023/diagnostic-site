// Point d'entrée unique pour "des bâtiments avec hauteur" : IGN BD TOPO® en
// priorité (plus précis qu'OSM, hauteur mesurée plutôt que déduite d'un tag
// facultatif), repli automatique sur OpenStreetMap si le WFS échoue ou ne
// couvre pas la zone. Utilisé par Urbanisme et Soleil — un seul endroit à
// faire évoluer si la source change.
import { fetchBdTopoBuildings } from "./bdtopo-buildings";
import { fetchOsmBuildings, type BuildingFootprint } from "./osm-buildings";
import type { SiteContext } from "./types";

export type BuildingSource = "bdtopo" | "osm" | "indisponible";

export interface BuildingsResult {
  buildings: BuildingFootprint[];
  source: BuildingSource;
}

export async function fetchBuildingsWithHeight(
  ctx: SiteContext,
  radiusM: number,
): Promise<BuildingsResult> {
  const bdTopo = await fetchBdTopoBuildings(ctx.lat, ctx.lon, radiusM);
  if (bdTopo && bdTopo.length > 0) {
    return { buildings: bdTopo, source: "bdtopo" };
  }

  const osm = await fetchOsmBuildings(ctx, radiusM);
  return {
    buildings: osm.buildings,
    source: osm.fetchFailed || osm.buildings.length === 0 ? "indisponible" : "osm",
  };
}

export const BUILDING_SOURCE_LABEL: Record<BuildingSource, string> = {
  bdtopo: "IGN BD TOPO®",
  osm: "OpenStreetMap (repli)",
  indisponible: "indisponible",
};
