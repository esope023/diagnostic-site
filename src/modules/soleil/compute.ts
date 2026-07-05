// Calculs soleil : masque de l'horizon (bâtiments voisins), trajectoires
// solaires de référence, durée d'ensoleillement théorique vs masquée,
// potentiel PV (passthrough de PVGIS). Pur, sans I/O.
//
// LIMITES ASSUMÉES (documentées aussi dans l'export) :
//  - Le masque est échantillonné aux SOMMETS des bâtiments (pas une silhouette
//    pleine), en 36 secteurs de 10°. Approximation correcte pour des masses
//    bâties simples, plus grossière pour des formes complexes.
//  - Hauteur par défaut de 9 m appliquée aux bâtiments sans hauteur connue
//    (taux de couverture affiché) — sinon le masque serait sous-estimé.
//  - Durée d'ensoleillement mensuelle calculée sur le 15 de chaque mois
//    (jour représentatif), pas intégrée sur tous les jours du mois.
//  - Ne tient compte QUE des masques bâtis : la nébulosité réelle (nuages)
//    est dans le module Climat (rayonnement), à lire en complément.
import type { BuildingFootprint } from "../../core/osm-buildings";
import { bearingDeg, distanceMeters } from "../../core/geo";
import type { LatLon } from "../../core/geo";
import type { SiteContext } from "../../core/types";
import type { SoleilRaw, PvRaw } from "./fetch";
import {
  declinationDeg,
  elevationDeg,
  azimuthDeg,
  sunriseHourAngleDeg,
  hourAngleToSolarHour,
  REFERENCE_DAYS,
  MID_MONTH_DAYS,
} from "./solar-position";

const SECTORS = 36;
const SECTOR_SIZE = 360 / SECTORS;
export const DEFAULT_HEIGHT_M = 9; // hypothèse R+2 quand la hauteur est inconnue
const HA_STEP_DEG = 2; // pas d'échantillonnage angle horaire (~8 min)

export interface SunPathPoint {
  azimuthDeg: number;
  elevationDeg: number;
  solarHour: number;
}
export interface SunPath {
  label: string;
  points: SunPathPoint[];
}

export interface SoleilResult {
  effectiveRadiusM: number;
  heightSource: "bdtopo" | "osm" | "indisponible";
  buildingCount: number;
  heightCoveragePct: number;
  /** Élévation du masque (degrés) par secteur de 10°, 36 valeurs. */
  horizonMaskDeg: number[];
  sunPaths: SunPath[];
  monthlyTheoreticalHours: number[];
  monthlyMaskedHours: number[];
  annualTheoreticalHours: number;
  annualMaskedHours: number;
  maskLossPct: number;
  /** Facteur de vue du ciel (0-1), formule d'Oke à partir du masque bâti. */
  svf: number;
  pv: PvRaw | null;
  /** Passthrough pour l'héliodon 3D (render.ts) — pas utilisé dans l'export PDF. */
  buildings: BuildingFootprint[];
  /** Idem — arbres pour le repère visuel 3D uniquement (pas dans le calcul du masque). */
  trees: LatLon[];
}

function computeHorizonMask(ctx: SiteContext, buildings: BuildingFootprint[]): {
  mask: number[];
  coveragePct: number;
} {
  const mask = new Array(SECTORS).fill(0);
  const site = { lat: ctx.lat, lon: ctx.lon };
  let knownHeightCount = 0;

  for (const b of buildings) {
    if (b.heightM !== null) knownHeightCount++;
    const height = b.heightM ?? DEFAULT_HEIGHT_M;

    for (const vertex of b.polygon) {
      const dist = distanceMeters(site, vertex);
      if (dist < 1) continue; // évite div/0 si un sommet coïncide avec le site
      const elevAngle = (Math.atan2(height, dist) * 180) / Math.PI;
      const bearing = bearingDeg(site, vertex);
      const sector = Math.floor(bearing / SECTOR_SIZE) % SECTORS;
      if (elevAngle > mask[sector]) mask[sector] = elevAngle;
    }
  }

  const coveragePct =
    buildings.length > 0 ? Math.round((knownHeightCount / buildings.length) * 100) : 0;

  return { mask: mask.map((v) => Math.round(v * 10) / 10), coveragePct };
}

function maskAtAzimuth(mask: number[], az: number): number {
  const sector = Math.floor(((az % 360) + 360) % 360 / SECTOR_SIZE) % SECTORS;
  return mask[sector];
}

function computeSunPaths(latDeg: number): SunPath[] {
  return REFERENCE_DAYS.map(({ label, dayOfYear }) => {
    const decl = declinationDeg(dayOfYear);
    const haMax = sunriseHourAngleDeg(latDeg, decl);
    const points: SunPathPoint[] = [];
    for (let ha = -haMax; ha <= haMax; ha += HA_STEP_DEG) {
      const elev = elevationDeg(latDeg, decl, ha);
      if (elev <= 0) continue;
      const az = azimuthDeg(latDeg, decl, ha, elev);
      points.push({ azimuthDeg: az, elevationDeg: elev, solarHour: hourAngleToSolarHour(ha) });
    }
    return { label, points };
  });
}

function computeSunshineHours(latDeg: number, mask: number[]): {
  monthlyTheoretical: number[];
  monthlyMasked: number[];
} {
  const monthlyTheoretical: number[] = [];
  const monthlyMasked: number[] = [];

  for (const dayOfYear of MID_MONTH_DAYS) {
    const decl = declinationDeg(dayOfYear);
    const haMax = sunriseHourAngleDeg(latDeg, decl);
    const theoreticalHours = (2 * haMax) / 15;

    let maskedSteps = 0;
    let totalSteps = 0;
    for (let ha = -haMax; ha <= haMax; ha += HA_STEP_DEG) {
      const elev = elevationDeg(latDeg, decl, ha);
      if (elev <= 0) continue;
      totalSteps++;
      const az = azimuthDeg(latDeg, decl, ha, elev);
      if (elev > maskAtAzimuth(mask, az)) maskedSteps++;
    }
    const maskedHours = totalSteps > 0 ? theoreticalHours * (maskedSteps / totalSteps) : 0;

    monthlyTheoretical.push(Math.round(theoreticalHours * 10) / 10);
    monthlyMasked.push(Math.round(maskedHours * 10) / 10);
  }

  return { monthlyTheoretical, monthlyMasked };
}

/**
 * Facteur de vue du ciel (Sky View Factor), formule d'Oke pour un ciel
 * isotrope : SVF = 1 - Σ sin²(θᵢ) / n, où θᵢ est l'élévation du masque dans
 * chaque secteur. Référence : Oke, T.R. (1981/1987), Boundary Layer Climates.
 *
 * LIMITES : dérivé du même masque bâti que le diagramme de masques (sommets
 * des bâtiments, pas de relief ni de végétation) — c'est une valeur AU POINT
 * du site, pas une carte de SVF sur le quartier.
 */
function computeSVF(mask: number[]): number {
  const sumSin2 = mask.reduce((s, deg) => s + Math.sin((deg * Math.PI) / 180) ** 2, 0);
  return Math.round((1 - sumSin2 / mask.length) * 1000) / 1000;
}

/** Lecture qualitative indicative du SVF — seuils usuels en climatologie urbaine,
 * pas une norme réglementaire. */
export function svfLabel(svf: number): string {
  if (svf >= 0.85) return "Ciel très dégagé";
  if (svf >= 0.6) return "Ciel dégagé";
  if (svf >= 0.35) return "Semi-encaissé";
  return "Rue canyon (fortement encaissé)";
}

export function computeSoleil(raw: SoleilRaw, ctx: SiteContext): SoleilResult {
  const { mask, coveragePct } = computeHorizonMask(ctx, raw.buildings);
  const sunPaths = computeSunPaths(ctx.lat);
  const { monthlyTheoretical, monthlyMasked } = computeSunshineHours(ctx.lat, mask);

  const annualTheoretical = Math.round(monthlyTheoretical.reduce((a, b) => a + b, 0) * 30.4);
  const annualMasked = Math.round(monthlyMasked.reduce((a, b) => a + b, 0) * 30.4);
  const maskLossPct =
    annualTheoretical > 0
      ? Math.round((1 - annualMasked / annualTheoretical) * 1000) / 10
      : 0;

  return {
    effectiveRadiusM: raw.effectiveRadiusM,
    heightSource: raw.heightSource,
    buildingCount: raw.buildings.length,
    heightCoveragePct: coveragePct,
    horizonMaskDeg: mask,
    sunPaths,
    monthlyTheoreticalHours: monthlyTheoretical,
    monthlyMaskedHours: monthlyMasked,
    annualTheoreticalHours: annualTheoretical,
    annualMaskedHours: annualMasked,
    maskLossPct,
    svf: computeSVF(mask),
    pv: raw.pv,
    buildings: raw.buildings,
    trees: raw.trees,
  };
}
