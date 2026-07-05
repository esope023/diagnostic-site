// Récupération des emprises bâties via l'utilitaire partagé
// src/core/buildings.ts : IGN BD TOPO® en priorité (hauteur mesurée, plus
// précise), repli OpenStreetMap si le WFS échoue. Même source que le module
// Soleil, pour des CES/COS/hauteurs cohérents entre modules.
import type { SiteContext } from "../../core/types";
import { fetchBuildingsWithHeight, type BuildingSource } from "../../core/buildings";
import type { BuildingFootprint } from "../../core/osm-buildings";

export const FALLBACK_RADIUS_M = 50;
export type { BuildingSource as HeightSource } from "../../core/buildings";

export interface UrbanismeRaw {
  effectiveRadiusM: number;
  buildings: BuildingFootprint[];
  heightSource: BuildingSource;
  fetchFailed: boolean;
}

export async function fetchUrbanisme(ctx: SiteContext): Promise<UrbanismeRaw> {
  const r = ctx.radiusM ?? FALLBACK_RADIUS_M;
  const { buildings, source } = await fetchBuildingsWithHeight(ctx, r);
  return {
    effectiveRadiusM: r,
    buildings,
    heightSource: source,
    fetchFailed: source === "indisponible" && buildings.length === 0,
  };
}
