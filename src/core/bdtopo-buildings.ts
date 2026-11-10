// Récupération des bâtiments via IGN BD TOPO® (WFS Géoplateforme) — source la
// plus précise pour la hauteur des bâtiments. Extrait de soleil/fetch.ts pour
// être réutilisé aussi par le module Urbanisme (voir src/core/buildings.ts).
import { fetchJson } from "../api/client";
import { ignWfsBatiments } from "../api/endpoints";
import { bboxAroundMeters } from "./geo";
import type { BuildingFootprint } from "./osm-buildings";

interface IgnBatimentFeature {
  // BD TOPO v3 livre les bâtiments en MultiPolygon (souvent 3D : [lon, lat, z]).
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
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

/** Anneaux extérieurs d'un Polygon ou d'un MultiPolygon (≥ 3 sommets). */
function outerRings(geometry: IgnBatimentFeature["geometry"] | undefined): number[][][] {
  if (!geometry?.coordinates) return [];
  const rings =
    geometry.type === "Polygon"
      ? [(geometry.coordinates as number[][][])[0]]
      : geometry.type === "MultiPolygon"
        ? (geometry.coordinates as number[][][][]).map((poly) => poly[0])
        : [];
  return rings.filter((r) => Array.isArray(r) && r.length >= 3);
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

    const buildings: BuildingFootprint[] = [];
    for (const f of data.features) {
      const heightM = extractHeight(f.properties);
      for (const ring of outerRings(f.geometry)) {
        buildings.push({
          polygon: ring.map(([lon2, lat2]) => ({ lat: lat2, lon: lon2 })),
          heightM,
        });
      }
    }
    // Rien d'exploitable : null pour déclencher le repli OSM.
    return buildings.length > 0 ? buildings : null;
  } catch {
    return null;
  }
}
