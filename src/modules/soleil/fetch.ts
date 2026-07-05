// Récupération : bâtiments voisins avec hauteur (pour les masques, via
// l'utilitaire partagé src/core/buildings.ts), arbres (pour l'héliodon 3D
// uniquement — voir note dans compute.ts), et estimation PV via PVGIS
// (nécessite le proxy Cloudflare — voir README).
import { fetchJson } from "../../api/client";
import { PROXY_BASE, pvgis, OVERPASS } from "../../api/endpoints";
import { fetchBuildingsWithHeight, type BuildingSource } from "../../core/buildings";
import type { BuildingFootprint } from "../../core/osm-buildings";
import type { LatLon } from "../../core/geo";
import type { SiteContext } from "../../core/types";

export const FALLBACK_RADIUS_M = 100; // les masques n'ont guère de sens à moins de 100 m
export type { BuildingSource as HeightSource } from "../../core/buildings";

export interface SoleilRaw {
  effectiveRadiusM: number;
  buildings: BuildingFootprint[];
  heightSource: BuildingSource;
  trees: LatLon[];
  pv: PvRaw | null;
}

export interface PvRaw {
  annualKwhPerKwc: number | null;
  monthlyKwhPerKwc: number[] | null;
}

interface OverpassTreeNode {
  type: "node";
  lat: number;
  lon: number;
}
interface OverpassTreeResponse {
  elements: OverpassTreeNode[];
}

/** Arbres recensés (position uniquement — OSM ne fournit quasiment jamais de
 * hauteur d'arbre fiable). Sert seulement à peupler l'héliodon 3D pour le
 * repère visuel : n'entre PAS dans le calcul du masque solaire, qui reste
 * basé sur les bâtiments (une hauteur de couronne d'arbre non mesurée
 * fausserait le calcul plus qu'elle ne l'affinerait). */
async function fetchTrees(ctx: SiteContext, radiusM: number): Promise<LatLon[]> {
  const query = `
    [out:json][timeout:20];
    node["natural"="tree"](around:${radiusM},${ctx.lat},${ctx.lon});
    out body;
  `.trim();

  try {
    const url = `${OVERPASS}?data=${encodeURIComponent(query)}`;
    const data = await fetchJson<OverpassTreeResponse>(url, {
      cacheKey: `overpass:trees-${radiusM}m`,
      ttlMs: 30 * 24 * 60 * 60 * 1000,
      timeoutMs: 20_000,
      retries: 2,
    });
    return data.elements
      .filter((e) => e.type === "node")
      .map((e) => ({ lat: e.lat, lon: e.lon }));
  } catch {
    return []; // pas bloquant : l'héliodon s'affiche simplement sans arbres
  }
}

async function fetchPv(ctx: SiteContext): Promise<PvRaw | null> {
  if (!PROXY_BASE) return null; // proxy non déployé : voir worker/pvgis-proxy.js
  try {
    const url =
      `${pvgis("PVcalc")}&lat=${ctx.lat}&lon=${ctx.lon}` +
      `&peakpower=3&loss=14&pvtechchoice=crystSi&mountingplace=building` +
      `&optimalangles=1&outputformat=json`;
    const data = await fetchJson<{
      outputs?: {
        totals?: { fixed?: { E_y?: number } };
        monthly?: { fixed?: { month: number; E_m: number }[] };
      };
    }>(url, { cacheKey: "pvgis:pvcalc-3kwc", ttlMs: 180 * 24 * 60 * 60 * 1000, timeoutMs: 25_000 });

    const annual = data.outputs?.totals?.fixed?.E_y ?? null;
    const monthlyRaw = data.outputs?.monthly?.fixed;
    const monthly = monthlyRaw
      ? Array.from({ length: 12 }, (_, i) => monthlyRaw.find((m) => m.month === i + 1)?.E_m ?? 0)
      : null;

    return { annualKwhPerKwc: annual, monthlyKwhPerKwc: monthly };
  } catch {
    return null; // PVGIS/proxy indisponible : le module l'affichera explicitement
  }
}

export async function fetchSoleil(ctx: SiteContext): Promise<SoleilRaw> {
  const r = ctx.radiusM ?? FALLBACK_RADIUS_M;

  const [{ buildings, source: heightSource }, trees, pv] = await Promise.all([
    fetchBuildingsWithHeight(ctx, r),
    fetchTrees(ctx, r),
    fetchPv(ctx),
  ]);

  return { effectiveRadiusM: r, buildings, heightSource, trees, pv };
}
