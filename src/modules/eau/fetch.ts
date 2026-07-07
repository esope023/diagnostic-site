// Récupération : emprise bâtie (Overpass/OSM) autour du point, précipitations
// (Open-Meteo), et piézométrie de la nappe la plus proche (Hub'Eau). Chaque
// source est indépendante ; si l'une échoue, le module dégrade proprement
// (voir compute.ts).
import { fetchJson } from "../../api/client";
import { OVERPASS, OPEN_METEO, hubeauStations, hubeauDerniereMesure } from "../../api/endpoints";
import { bboxAroundMeters, distanceMeters } from "../../core/geo";
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

export interface PiezoRaw {
  codeBss: string;
  nomCommune: string | null;
  distanceM: number;
  profondeurNappeM: number | null;
  dateMesure: string | null;
}

export interface EauRaw {
  /** Polygones des bâtiments trouvés à proximité (peut être vide). */
  buildings: LatLon[][];
  /** Précipitations mensuelles moyennes (mm), 12 valeurs, normales 1991-2020. */
  monthlyPrecip: number[];
  annualPrecip: number;
  /** Piézomètre le plus proche avec sa dernière mesure, null si aucun trouvé. */
  piezo: PiezoRaw | null;
  piezoFetchFailed: boolean;
}

const SEARCH_RADIUS_M = 40;
/** Les piézomètres sont rares (quelques milliers en France) : rayon large
 * nécessaire pour espérer en trouver un — ce n'est donc jamais une mesure
 * "sur site", juste l'indication la plus proche disponible. */
const PIEZO_SEARCH_RADIUS_M = 15_000;

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

interface StationsResponse {
  data: {
    code_bss: string;
    nom_commune?: string;
    x: number; // longitude
    y: number; // latitude
    date_fin_mesure?: string;
  }[];
}
interface ChroniquesResponse {
  data: { profondeur_nappe?: number; date_mesure?: string }[];
}

async function fetchPiezo(ctx: SiteContext): Promise<{ piezo: PiezoRaw | null; fetchFailed: boolean }> {
  try {
    const bbox = bboxAroundMeters(ctx.lat, ctx.lon, PIEZO_SEARCH_RADIUS_M);
    const stationsData = await fetchJson<StationsResponse>(hubeauStations(bbox), {
      cacheKey: `hubeau:stations-${PIEZO_SEARCH_RADIUS_M}m`,
      ttlMs: 30 * 24 * 60 * 60 * 1000,
      timeoutMs: 15_000,
      retries: 1,
    });

    if (!stationsData.data || stationsData.data.length === 0) {
      return { piezo: null, fetchFailed: false }; // vraiment aucun piézomètre à proximité
    }

    const site = { lat: ctx.lat, lon: ctx.lon };
    let nearest = stationsData.data[0];
    let nearestDist = distanceMeters(site, { lat: nearest.y, lon: nearest.x });
    for (const s of stationsData.data.slice(1)) {
      const d = distanceMeters(site, { lat: s.y, lon: s.x });
      if (d < nearestDist) {
        nearest = s;
        nearestDist = d;
      }
    }

    const chroniques = await fetchJson<ChroniquesResponse>(hubeauDerniereMesure(nearest.code_bss), {
      cacheKey: `hubeau:derniere-mesure-${nearest.code_bss}`,
      ttlMs: 7 * 24 * 60 * 60 * 1000, // les mesures évoluent, cache plus court
      timeoutMs: 15_000,
      retries: 1,
    });
    const derniere = chroniques.data?.[0];

    return {
      piezo: {
        codeBss: nearest.code_bss,
        nomCommune: nearest.nom_commune ?? null,
        distanceM: Math.round(nearestDist),
        profondeurNappeM: derniere?.profondeur_nappe ?? null,
        dateMesure: derniere?.date_mesure ?? null,
      },
      fetchFailed: false,
    };
  } catch {
    return { piezo: null, fetchFailed: true };
  }
}

export async function fetchEau(ctx: SiteContext): Promise<EauRaw> {
  const [buildings, precip, piezoResult] = await Promise.all([
    fetchBuildings(ctx),
    fetchPrecip(ctx),
    fetchPiezo(ctx),
  ]);
  return {
    buildings,
    monthlyPrecip: precip.monthly,
    annualPrecip: precip.annual,
    piezo: piezoResult.piezo,
    piezoFetchFailed: piezoResult.fetchFailed,
  };
}
