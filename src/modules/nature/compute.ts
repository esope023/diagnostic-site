// Calculs nature : couverture végétale/eau (%), proxy canopée, densité
// d'arbres recensés. Pur, sans I/O.
//
// LIMITE ASSUMÉE : Overpass "around" renvoie les polygones entiers dès qu'un
// point touche le rayon (pas de découpage géométrique au bord du cercle,
// qui demanderait une lib type turf). Les surfaces sont donc une borne haute,
// pas une mesure exacte de ce qui est strictement dans le cercle. Documenté
// dans l'export, pas masqué.
import type { NatureRaw } from "./fetch";
import { polygonAreaM2 } from "../../core/geo";

export interface NatureResult {
  effectiveRadiusM: number;
  fetchFailed: boolean;
  circleAreaM2: number;
  greenAreaM2: number;
  greenPct: number;
  waterAreaM2: number;
  waterPct: number;
  canopyAreaM2: number;
  canopyPct: number;
  treeCount: number;
  /** Arbres recensés pour 10 000 m² (1 ha). */
  treeDensityHa: number;
}

function sumArea(polys: { lat: number; lon: number }[][]): number {
  return polys.reduce((s, p) => s + polygonAreaM2(p), 0);
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 1000) / 10);
}

export function computeNature(raw: NatureRaw): NatureResult {
  const circleAreaM2 = Math.PI * raw.effectiveRadiusM ** 2;

  const greenAreaM2 = Math.round(sumArea(raw.greenPolygons));
  const waterAreaM2 = Math.round(sumArea(raw.waterPolygons));
  const canopyAreaM2 = Math.round(sumArea(raw.canopyPolygons));

  const hectares = circleAreaM2 / 10000;

  return {
    effectiveRadiusM: raw.effectiveRadiusM,
    fetchFailed: raw.fetchFailed,
    circleAreaM2: Math.round(circleAreaM2),
    greenAreaM2,
    greenPct: pct(greenAreaM2, circleAreaM2),
    waterAreaM2,
    waterPct: pct(waterAreaM2, circleAreaM2),
    canopyAreaM2,
    canopyPct: pct(canopyAreaM2, circleAreaM2),
    treeCount: raw.treeCount,
    treeDensityHa: hectares > 0 ? Math.round((raw.treeCount / hectares) * 10) / 10 : 0,
  };
}
