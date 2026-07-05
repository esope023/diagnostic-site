// Récupération : emprise bâtie (Overpass/OSM) autour du point, et
// précipitations (Open-Meteo). Les deux sources sont indépendantes ; si le
// bâtiment n'est pas trouvé dans OSM, le module dégrade proprement (voir compute.ts).
import { fetchJson } from "../../api/client";
import { OVERPASS, OPEN_METEO } from "../../api/endpoints";
import type { SiteContext } from "../../core/types";
import type { LatLon } from "../../core/geo";

export interface OverpassWay {
  type: "way";
  id: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}
interface OverpassResponse {
  elements: OverpassWay[];
}

export interface EauRaw {
  /** Polygones des bâtiments trouvés à proximité (peut être vide). */
  buildings: LatLon[][];
  /** Précipitations mensuelles moyennes (mm), 12 valeurs, normales 1991-2020. */
  monthlyPrecip: number[];
  annualPrecip: number;
}

const SEARCH_RADIUS_M = 40;

async function fetchBuildings(ctx: SiteContext): Promise<LatLon[][]> {
  const query = `
    [out:json][timeout:25];
    way["building"](around:${SEARCH_RADIUS_M},${ctx.lat},${ctx.lon});
    out geom;
  `.trim();

  try {
    const url = `${OVERPASS}?data=${encodeURIComponent(query)}`;
    const data = await fetchJson<OverpassResponse>(url, {
      cacheKey: "overpass:buildings",
      ttlMs: 30 * 24 * 60 * 60 * 1000,
      timeoutMs: 25_000,
      retries: 2,
    });
    return data.elements
      .filter((w) => w.geometry && w.geometry.length >= 3)
      .map((w) => w.geometry!.map((p) => ({ lat: p.lat, lon: p.lon })));
  } catch {
    // Overpass peut être lent/indisponible : on continue sans emprise bâtie,
    // le module compute.ts affichera l'indicateur en absence.
    return [];
  }
}

async function fetchPrecip(ctx: SiteContext): Promise<{ monthly: number[]; annual: number }> {
  const url =
    `${OPEN_METEO.archive}?latitude=${ctx.lat}&longitude=${ctx.lon}` +
    `&start_date=1991-01-01&end_date=2020-12-31` +
    `&daily=precipitation_sum&timezone=${encodeURIComponent(ctx.timezone)}`;

  const data = await fetchJson<{ daily: { time: string[]; precipitation_sum: number[] } }>(
    url,
    { cacheKey: "open-meteo:precip-1991-2020", ttlMs: 90 * 24 * 60 * 60 * 1000, timeoutMs: 40_000 },
  );

  const years = new Set(data.daily.time.map((t) => t.slice(0, 4))).size;
  const monthlySum = new Array(12).fill(0);
  data.daily.time.forEach((t, i) => {
    const m = Number(t.slice(5, 7)) - 1;
    monthlySum[m] += data.daily.precipitation_sum[i] ?? 0;
  });
  const monthly = monthlySum.map((s) => s / years);
  const annual = monthly.reduce((a, b) => a + b, 0);
  return { monthly, annual };
}

export async function fetchEau(ctx: SiteContext): Promise<EauRaw> {
  const [buildings, precip] = await Promise.all([fetchBuildings(ctx), fetchPrecip(ctx)]);
  return { buildings, monthlyPrecip: precip.monthly, annualPrecip: precip.annual };
}
