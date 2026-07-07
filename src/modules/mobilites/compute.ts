// Calculs mobilités : longueur d'infrastructure cyclable par catégorie,
// densité, synthèse transport en commun. Pur, sans I/O.
import type { MobilitesRaw, TransitStop, TransitLine } from "./fetch";
import { lineLengthM } from "../../core/geo";

export interface MobilitesResult {
  effectiveRadiusM: number;
  fetchFailed: boolean;
  cyclingKmAmenagee: number;
  cyclingKmPartagee: number;
  cyclingKmProjet: number;
  /** km d'infra cyclable aménagée+partagée pour 1 km² du rayon analysé. */
  cyclingDensityKmKm2: number;
  transitStopsByMode: Record<TransitStop["mode"], number>;
  transitLines: TransitLine[];
}

export const MODE_LABELS: Record<TransitStop["mode"], string> = {
  bus: "Bus",
  tram: "Tramway",
  metro_train: "Métro / Train / RER",
};

export function computeMobilites(raw: MobilitesRaw): MobilitesResult {
  let mAmenagee = 0;
  let mPartagee = 0;
  let mProjet = 0;

  for (const seg of raw.cyclingSegments) {
    const len = lineLengthM(seg.polyline);
    if (seg.category === "amenagee") mAmenagee += len;
    else if (seg.category === "partagee") mPartagee += len;
    else mProjet += len;
  }

  const circleAreaKm2 = (Math.PI * raw.effectiveRadiusM ** 2) / 1_000_000;
  const cyclingDensityKmKm2 =
    circleAreaKm2 > 0 ? Math.round(((mAmenagee + mPartagee) / 1000 / circleAreaKm2) * 10) / 10 : 0;

  const transitStopsByMode: Record<TransitStop["mode"], number> = { bus: 0, tram: 0, metro_train: 0 };
  for (const s of raw.transitStops) transitStopsByMode[s.mode]++;

  return {
    effectiveRadiusM: raw.effectiveRadiusM,
    fetchFailed: raw.fetchFailed,
    cyclingKmAmenagee: Math.round((mAmenagee / 1000) * 10) / 10,
    cyclingKmPartagee: Math.round((mPartagee / 1000) * 10) / 10,
    cyclingKmProjet: Math.round((mProjet / 1000) * 10) / 10,
    cyclingDensityKmKm2,
    transitStopsByMode,
    transitLines: raw.transitLines,
  };
}
