// Récupération des bâtiments via IGN BD TOPO® (WFS Géoplateforme) — source la
// plus précise pour la hauteur des bâtiments. Extrait de soleil/fetch.ts pour
// être réutilisé aussi par le module Urbanisme (voir src/core/buildings.ts).
import { fetchJson } from "../api/client";
import { ignWfsBatiments } from "../api/endpoints";
import { bboxAroundMeters } from "./geo";
import type { BuildingFootprint } from "./osm-buildings";

interface IgnBatimentFeature {
  geometry: { type: string; coordinates: number[][][] };
  properties: Record<string, unknown>;
}
interface IgnBatimentResponse {
  features: IgnBatimentFeature[];
}

function extractHeight(props: Record<string, unknown>): number | null {
  // Noms d'attributs BD TOPO usuels ; à ajuster si le schéma diffère (voir
  // note dans src/api/endpoints.ts).
  const candidates = ["hauteur", "HAUTEUR", "z_max", "altitude_max"];
  for (const key of candidates) {
    const v = props[key];
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

/** Retourne null si le WFS échoue ou ne renvoie rien d'exploitable (déclenche le repli OSM). */
export async function fetchBdTopoBuildings(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<BuildingFootprint[] | null> {
  try {
    const bbox = bboxAroundMeters(lat, lon, radiusM);
    const url = ignWfsBatiments(bbox);
    const data = await fetchJson<IgnBatimentResponse>(url, {
      cacheKey: `ign-wfs:batiments-${radiusM}m`,
      ttlMs: 30 * 24 * 60 * 60 * 1000,
      timeoutMs: 25_000,
      retries: 2,
    });

    if (!data.features || data.features.length === 0) return null;

    return data.features
      .filter((f) => f.geometry?.type === "Polygon" && f.geometry.coordinates?.[0]?.length >= 3)
      .map((f) => ({
        polygon: f.geometry.coordinates[0].map(([lon2, lat2]) => ({ lat: lat2, lon: lon2 })),
        heightM: extractHeight(f.properties),
      }));
  } catch {
    return null;
  }
}
