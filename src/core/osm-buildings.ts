// Récupération partagée des bâtiments OSM avec hauteur estimée.
// Utilisé par Urbanisme (source principale) et par Soleil (repli si le WFS
// IGN BD TOPO échoue). Factorisé ici pour ne pas dupliquer la requête Overpass.
import { fetchJson } from "../api/client";
import { OVERPASS } from "../api/endpoints";
import type { SiteContext } from "./types";
import type { LatLon } from "./geo";

export interface BuildingFootprint {
  polygon: LatLon[];
  /** Hauteur estimée en mètres, null si aucune donnée exploitable. */
  heightM: number | null;
}

export interface OsmBuildingsResult {
  buildings: BuildingFootprint[];
  fetchFailed: boolean;
}

interface OverpassWay {
  type: "way";
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}
interface OverpassResponse {
  elements: OverpassWay[];
}

const METERS_PER_LEVEL = 3; // conversion usuelle niveaux -> hauteur

function estimateHeight(tags: Record<string, string> = {}): number | null {
  if (tags.height) {
    const h = parseFloat(tags.height);
    if (!Number.isNaN(h)) return h;
  }
  if (tags["building:levels"]) {
    const levels = parseFloat(tags["building:levels"]);
    if (!Number.isNaN(levels)) return levels * METERS_PER_LEVEL;
  }
  return null;
}

export async function fetchOsmBuildings(
  ctx: SiteContext,
  radiusM: number,
): Promise<OsmBuildingsResult> {
  const query = `
    [out:json][timeout:25];
    way["building"](around:${radiusM},${ctx.lat},${ctx.lon});
    out geom;
  `.trim();

  try {
    const url = `${OVERPASS}?data=${encodeURIComponent(query)}`;
    const data = await fetchJson<OverpassResponse>(url, {
      cacheKey: `overpass:buildings-height-${radiusM}m`,
      ttlMs: 30 * 24 * 60 * 60 * 1000,
      timeoutMs: 25_000,
      retries: 2,
    });

    const buildings: BuildingFootprint[] = data.elements
      .filter((w) => w.geometry && w.geometry.length >= 3)
      .map((w) => ({
        polygon: w.geometry!.map((p) => ({ lat: p.lat, lon: p.lon })),
        heightM: estimateHeight(w.tags),
      }));

    return { buildings, fetchFailed: false };
  } catch {
    return { buildings: [], fetchFailed: true };
  }
}
