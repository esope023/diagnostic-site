// Récupération : infrastructures cyclables et transport en commun, via
// Overpass (OSM), dans le rayon d'analyse "quartier".
//
// Strava a été volontairement exclu (voir README) : la heatmap globale exige
// un compte connecté et ses CGU interdisent la réutilisation hors de leurs
// produits ; les données individuelles demandent un OAuth par utilisateur ;
// Strava Metro est réservé aux collectivités partenaires. Rien d'intégrable
// proprement dans un outil diffusé.
import { fetchJson } from "../../api/client";
import { OVERPASS } from "../../api/endpoints";
import type { SiteContext } from "../../core/types";
import type { LatLon } from "../../core/geo";

export const FALLBACK_RADIUS_M = 300; // infra cyclable/TC n'a de sens qu'à l'échelle du quartier

interface OverpassWay {
  type: "way";
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}
interface OverpassNode {
  type: "node";
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
interface OverpassRelation {
  type: "relation";
  tags?: Record<string, string>;
}
type OverpassElement = OverpassWay | OverpassNode | OverpassRelation;
interface OverpassResponse {
  elements: OverpassElement[];
}

export type CyclingCategory = "amenagee" | "partagee" | "projet";
export interface CyclingSegment {
  category: CyclingCategory;
  polyline: LatLon[];
}

export interface TransitStop {
  mode: "bus" | "tram" | "metro_train";
  name: string | null;
}
export interface TransitLine {
  mode: "bus" | "tram" | "metro_train";
  ref: string | null;
  name: string | null;
}

export interface MobilitesRaw {
  effectiveRadiusM: number;
  cyclingSegments: CyclingSegment[];
  transitStops: TransitStop[];
  transitLines: TransitLine[];
  fetchFailed: boolean;
}

function classifyCycling(tags: Record<string, string> = {}): CyclingCategory | null {
  if (tags.highway === "construction" && tags.construction === "cycleway") return "projet";
  if (tags.proposed === "cycleway" || tags.cycleway === "proposed") return "projet";
  if (tags.highway === "cycleway") return "amenagee";
  const shared = ["lane", "shared_lane", "opposite_lane", "opposite_track"];
  const dedicated = ["track"];
  for (const key of ["cycleway", "cycleway:right", "cycleway:left", "cycleway:both"]) {
    const v = tags[key];
    if (v && dedicated.includes(v)) return "amenagee";
    if (v && shared.includes(v)) return "partagee";
  }
  return null;
}

async function fetchCycling(ctx: SiteContext, r: number): Promise<CyclingSegment[]> {
  const query = `
    [out:json][timeout:25];
    (
      way["highway"="cycleway"](around:${r},${ctx.lat},${ctx.lon});
      way["highway"]["cycleway"](around:${r},${ctx.lat},${ctx.lon});
      way["highway"]["cycleway:right"](around:${r},${ctx.lat},${ctx.lon});
      way["highway"]["cycleway:left"](around:${r},${ctx.lat},${ctx.lon});
      way["highway"]["cycleway:both"](around:${r},${ctx.lat},${ctx.lon});
      way["highway"="construction"]["construction"="cycleway"](around:${r},${ctx.lat},${ctx.lon});
      way["proposed"="cycleway"](around:${r},${ctx.lat},${ctx.lon});
    );
    out geom;
  `.trim();

  const url = `${OVERPASS}?data=${encodeURIComponent(query)}`;
  const data = await fetchJson<OverpassResponse>(url, {
    cacheKey: `overpass:cycling-${r}m`,
    ttlMs: 20 * 24 * 60 * 60 * 1000,
    timeoutMs: 25_000,
    retries: 2,
  });

  const segments: CyclingSegment[] = [];
  for (const el of data.elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const category = classifyCycling(el.tags);
    if (!category) continue;
    segments.push({ category, polyline: el.geometry.map((p) => ({ lat: p.lat, lon: p.lon })) });
  }
  return segments;
}

function transitMode(tags: Record<string, string> = {}): TransitStop["mode"] | null {
  if (tags.railway === "tram_stop") return "tram";
  if (["station", "halt"].includes(tags.railway ?? "")) return "metro_train";
  if (tags.highway === "bus_stop" || tags.public_transport === "stop_position" || tags.bus === "yes")
    return "bus";
  return null;
}

async function fetchTransit(
  ctx: SiteContext,
  r: number,
): Promise<{ stops: TransitStop[]; lines: TransitLine[] }> {
  const query = `
    [out:json][timeout:25];
    (
      node["highway"="bus_stop"](around:${r},${ctx.lat},${ctx.lon});
      node["railway"~"^(tram_stop|station|halt)$"](around:${r},${ctx.lat},${ctx.lon});
      relation["route"~"^(bus|tram|subway|light_rail|train)$"](around:${r},${ctx.lat},${ctx.lon});
    );
    out tags center;
  `.trim();

  const url = `${OVERPASS}?data=${encodeURIComponent(query)}`;
  const data = await fetchJson<OverpassResponse>(url, {
    cacheKey: `overpass:transit-${r}m`,
    ttlMs: 20 * 24 * 60 * 60 * 1000,
    timeoutMs: 25_000,
    retries: 2,
  });

  const stops: TransitStop[] = [];
  const lines: TransitLine[] = [];

  for (const el of data.elements) {
    if (el.type === "node") {
      const mode = transitMode(el.tags);
      if (mode) stops.push({ mode, name: el.tags?.name ?? null });
    } else if (el.type === "relation") {
      const routeType = el.tags?.route;
      const mode: TransitLine["mode"] | null =
        routeType === "bus" ? "bus" : routeType === "tram" ? "tram" : ["subway", "light_rail", "train"].includes(routeType ?? "") ? "metro_train" : null;
      if (mode) lines.push({ mode, ref: el.tags?.ref ?? null, name: el.tags?.name ?? null });
    }
  }

  // Dédoublonnage simple des lignes (même ref+nom peut apparaître plusieurs
  // fois : aller/retour, variantes de tracé).
  const seen = new Set<string>();
  const dedupedLines = lines.filter((l) => {
    const key = `${l.mode}|${l.ref ?? ""}|${l.name ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { stops, lines: dedupedLines };
}

export async function fetchMobilites(ctx: SiteContext): Promise<MobilitesRaw> {
  const r = ctx.radiusM ?? FALLBACK_RADIUS_M;
  try {
    const [cyclingSegments, transit] = await Promise.all([
      fetchCycling(ctx, r),
      fetchTransit(ctx, r),
    ]);
    return {
      effectiveRadiusM: r,
      cyclingSegments,
      transitStops: transit.stops,
      transitLines: transit.lines,
      fetchFailed: false,
    };
  } catch {
    return {
      effectiveRadiusM: r,
      cyclingSegments: [],
      transitStops: [],
      transitLines: [],
      fetchFailed: true,
    };
  }
}
