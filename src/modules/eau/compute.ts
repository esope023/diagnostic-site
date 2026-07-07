// Calculs eau : sélection du bâtiment du site, surface de toiture, potentiel
// de récupération d'eau pluviale. Pur, sans I/O.
import type { EauRaw, PiezoRaw } from "./fetch";
import type { SiteContext } from "../../core/types";
import { polygonAreaM2, pointInPolygon, centroid, distanceMeters } from "../../core/geo";

/** Coefficient de ruissellement toiture (tuile/ardoise, valeur usuelle 0.8-0.9). */
const RUNOFF_COEFFICIENT = 0.85;
/** Rendement du système de collecte (pertes premier flush, filtration). */
const COLLECTION_EFFICIENCY = 0.9;

export interface EauResult {
  /** Surface de toiture retenue (m²), null si aucun bâtiment trouvé à proximité. */
  roofAreaM2: number | null;
  annualPrecipMm: number;
  monthlyPrecipMm: number[];
  /** Volume annuel récupérable (litres), null si roofAreaM2 est null. */
  annualVolumeL: number | null;
  /** Volume mensuel récupérable (litres). */
  monthlyVolumeL: number[];
  piezo: PiezoRaw | null;
  piezoFetchFailed: boolean;
}

function pickBuilding(
  buildings: { lat: number; lon: number }[][],
  ctx: SiteContext,
): { lat: number; lon: number }[] | null {
  if (buildings.length === 0) return null;

  const containing = buildings.find((poly) => pointInPolygon({ lat: ctx.lat, lon: ctx.lon }, poly));
  if (containing) return containing;

  // Sinon, le plus proche par centroïde (le point cherché peut être dans la rue).
  let best = buildings[0];
  let bestDist = distanceMeters(centroid(best), { lat: ctx.lat, lon: ctx.lon });
  for (const poly of buildings.slice(1)) {
    const d = distanceMeters(centroid(poly), { lat: ctx.lat, lon: ctx.lon });
    if (d < bestDist) {
      best = poly;
      bestDist = d;
    }
  }
  return best;
}

export function computeEau(raw: EauRaw, ctx: SiteContext): EauResult {
  const building = pickBuilding(raw.buildings, ctx);
  const roofAreaM2 = building ? Math.round(polygonAreaM2(building)) : null;

  const volumeFactor = RUNOFF_COEFFICIENT * COLLECTION_EFFICIENCY; // L par m² par mm

  const monthlyVolumeL = raw.monthlyPrecip.map((mm) =>
    roofAreaM2 !== null ? Math.round(roofAreaM2 * mm * volumeFactor) : 0,
  );
  const annualVolumeL =
    roofAreaM2 !== null ? Math.round(roofAreaM2 * raw.annualPrecip * volumeFactor) : null;

  return {
    roofAreaM2,
    annualPrecipMm: Math.round(raw.annualPrecip),
    monthlyPrecipMm: raw.monthlyPrecip.map((v) => Math.round(v * 10) / 10),
    annualVolumeL,
    monthlyVolumeL,
    piezo: raw.piezo,
    piezoFetchFailed: raw.piezoFetchFailed,
  };
}

export { RUNOFF_COEFFICIENT, COLLECTION_EFFICIENCY };
