// Récupération des espaces verts/bleus et arbres via Overpass (OSM), dans le
// rayon d'analyse "quartier". Voir compute.ts pour les limites (polygones non
// découpés au bord du cercle).
import { fetchJson } from "../../api/client";
import { OVERPASS } from "../../api/endpoints";
import type { SiteContext } from "../../core/types";
import type { LatLon } from "../../core/geo";

/** Rayon minimal appliqué si l'utilisateur est en cadrage "Parcelle" : ce
 * module n'a de sens qu'à partir d'une échelle de voisinage. */
export const FALLBACK_RADIUS_M = 50;

interface OverpassElement {
  type: "way" | "node" | "relation";
  geometry?: { lat: number; lon: number }[];
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}
interface OverpassResponse {
  elements: OverpassElement[];
}

export interface NatureRaw {
  effectiveRadiusM: number;
  greenPolygons: LatLon[][];
  waterPolygons: LatLon[][];
  canopyPolygons: LatLon[][]; // sous-ensemble "boisé" des espaces verts
  treeCount: number;
  /** true si Overpass a échoué : à distinguer d'un résultat "vraiment 0". */
  fetchFailed: boolean;
}

function isGreenTag(tags: Record<string, string> = {}): boolean {
  return (
    ["wood", "scrub"].includes(tags.natural ?? "") ||
    ["forest", "meadow", "grass"].includes(tags.landuse ?? "") ||
    ["park", "garden"].includes(tags.leisure ?? "")
  );
}
function isCanopyTag(tags: Record<string, string> = {}): boolean {
  return tags.natural === "wood" || tags.landuse === "forest";
}
function isWaterTag(tags: Record<string, string> = {}): boolean {
  return tags.natural === "water" || tags.landuse === "basin";
}

export async function fetchNature(ctx: SiteContext): Promise<NatureRaw> {
  const r = ctx.radiusM ?? FALLBACK_RADIUS_M;

  const query = `
    [out:json][timeout:25];
    (
      way["natural"~"^(wood|scrub|water)$"](around:${r},${ctx.lat},${ctx.lon});
      way["landuse"~"^(forest|meadow|grass|basin)$"](around:${r},${ctx.lat},${ctx.lon});
      way["leisure"~"^(park|garden)$"](around:${r},${ctx.lat},${ctx.lon});
      node["natural"="tree"](around:${r},${ctx.lat},${ctx.lon});
    );
    out geom;
  `.trim();

  try {
    const url = `${OVERPASS}?data=${encodeURIComponent(query)}`;
    const data = await fetchJson<OverpassResponse>(url, {
      cacheKey: `overpass:nature-${r}m`,
      ttlMs: 30 * 24 * 60 * 60 * 1000,
      timeoutMs: 25_000,
      retries: 2,
    });

    const greenPolygons: LatLon[][] = [];
    const waterPolygons: LatLon[][] = [];
    const canopyPolygons: LatLon[][] = [];
    let treeCount = 0;

    for (const el of data.elements) {
      if (el.type === "node" && el.tags?.natural === "tree") {
        treeCount++;
        continue;
      }
      if (el.type !== "way" || !el.geometry || el.geometry.length < 3) continue;
      const poly = el.geometry.map((p) => ({ lat: p.lat, lon: p.lon }));
      if (isWaterTag(el.tags)) waterPolygons.push(poly);
      else if (isGreenTag(el.tags)) {
        greenPolygons.push(poly);
        if (isCanopyTag(el.tags)) canopyPolygons.push(poly);
      }
    }

    return {
      effectiveRadiusM: r,
      greenPolygons,
      waterPolygons,
      canopyPolygons,
      treeCount,
      fetchFailed: false,
    };
  } catch {
    // Overpass indisponible/timeout : le module l'affichera explicitement,
    // pas comme un site sans verdure ni eau.
    return {
      effectiveRadiusM: r,
      greenPolygons: [],
      waterPolygons: [],
      canopyPolygons: [],
      treeCount: 0,
      fetchFailed: true,
    };
  }
}
