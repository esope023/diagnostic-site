// Calculs urbanisme : emprise au sol (CES), densité approximative (COS),
// hauteur moyenne, orientation dominante, indice qualitatif d'îlot de chaleur.
// Pur, sans I/O.
//
// LIMITES ASSUMÉES (documentées aussi dans l'export) :
//  - Overpass ne découpe pas les polygones au bord du rayon (même limite que
//    le module Nature) : CES/COS sont une borne haute.
//  - La hauteur vient de `building:levels` × 3 m quand disponible ; beaucoup
//    de bâtiments OSM n'ont pas ce tag (taux de couverture affiché).
//  - L'indice d'îlot de chaleur est une HEURISTIQUE simplifiée (densité +
//    hauteur), pas une simulation d'îlot de chaleur urbain.
import type { UrbanismeRaw, HeightSource } from "./fetch";
import { polygonAreaM2, longestEdgeAzimuthDeg } from "../../core/geo";
import type { SiteContext } from "../../core/types";

export const ORIENTATION_LABELS = ["Nord-Sud", "Nord-Est / Sud-Ouest", "Est-Ouest", "Nord-Ouest / Sud-Est"];

// Seuils de l'indice qualitatif (volontairement explicites, pas de "magie").
const CES_LOW_PCT = 20;
const CES_HIGH_PCT = 40;
const HEIGHT_HIGH_M = 12;

export type RisqueIlotChaleur = "Faible" | "Modéré" | "Élevé" | "Indéterminé";

export interface UrbanismeResult {
  effectiveRadiusM: number;
  fetchFailed: boolean;
  buildingCount: number;
  heightSource: HeightSource;
  /** Surface de référence utilisée pour le CES/COS (cercle ou parcelle réelle). */
  referenceAreaM2: number;
  referenceAreaSource: "cercle" | "parcelle_cadastrale";
  parcelleReference: string | null;
  footprintAreaM2: number;
  /** Coefficient d'emprise au sol (%). */
  cesPct: number;
  /** Coefficient d'occupation des sols approximatif (m² plancher / m² terrain),
   *  calculé uniquement sur les bâtiments avec hauteur connue. */
  cosApprox: number;
  /** Part des bâtiments avec hauteur connue (%), pour juger la fiabilité du COS. */
  heightCoveragePct: number;
  meanHeightM: number | null;
  /** Fréquence (%) par orientation dominante (voir ORIENTATION_LABELS). */
  orientationPct: number[];
  dominantOrientation: number;
  risqueIlotChaleur: RisqueIlotChaleur;
}

function orientationBin(azimuthDeg: number): number {
  return Math.round(azimuthDeg / 45) % 4;
}

export function computeUrbanisme(raw: UrbanismeRaw, ctx: SiteContext): UrbanismeResult {
  const circleAreaM2 = Math.PI * raw.effectiveRadiusM ** 2;
  const buildingCount = raw.buildings.length;

  // CES/COS réglementaires se définissent par rapport à LA PARCELLE, pas un
  // cercle arbitraire. Quand le cadrage "Parcelle" est actif ET qu'une
  // parcelle cadastrale réelle a été trouvée (src/core/cadastre.ts), on
  // l'utilise comme dénominateur — c'est la définition correcte. Sinon
  // (cadrage "quartier" par rayon), le cercle reste la référence, cohérente
  // avec les autres modules "quartier".
  const useParcelle = ctx.radiusM === null && ctx.parcelle !== null;
  const referenceAreaM2 = useParcelle ? ctx.parcelle!.surfaceM2 : Math.round(circleAreaM2);
  const referenceAreaSource: "cercle" | "parcelle_cadastrale" = useParcelle
    ? "parcelle_cadastrale"
    : "cercle";

  let footprintAreaM2 = 0;
  let heightedArea = 0; // somme des surfaces des bâtiments à hauteur connue
  let heightedVolumeFloorArea = 0; // somme (surface * niveaux équivalents), pour le COS
  let knownHeightCount = 0;
  let heightSum = 0; // pondéré par surface, pour la hauteur moyenne

  const orientationAreaByBin = [0, 0, 0, 0];

  for (const b of raw.buildings) {
    const area = polygonAreaM2(b.polygon);
    footprintAreaM2 += area;

    const bin = orientationBin(longestEdgeAzimuthDeg(b.polygon));
    orientationAreaByBin[bin] += area;

    if (b.heightM !== null) {
      knownHeightCount++;
      heightedArea += area;
      heightSum += area * b.heightM;
      const levelsEquivalent = b.heightM / 3;
      heightedVolumeFloorArea += area * levelsEquivalent;
    }
  }

  const cesPct =
    referenceAreaM2 > 0 ? Math.min(100, Math.round((footprintAreaM2 / referenceAreaM2) * 1000) / 10) : 0;
  const cosApprox =
    referenceAreaM2 > 0 ? Math.round((heightedVolumeFloorArea / referenceAreaM2) * 100) / 100 : 0;
  const heightCoveragePct =
    buildingCount > 0 ? Math.round((knownHeightCount / buildingCount) * 100) : 0;
  const meanHeightM = heightedArea > 0 ? Math.round((heightSum / heightedArea) * 10) / 10 : null;

  const orientationTotal = orientationAreaByBin.reduce((a, b) => a + b, 0);
  const orientationPct = orientationAreaByBin.map((a) =>
    orientationTotal > 0 ? Math.round((a / orientationTotal) * 1000) / 10 : 0,
  );
  const dominantOrientation = orientationPct.reduce(
    (best, v, i) => (v > orientationPct[best] ? i : best),
    0,
  );

  const risqueIlotChaleur = computeRisque(cesPct, meanHeightM, buildingCount);

  return {
    effectiveRadiusM: raw.effectiveRadiusM,
    fetchFailed: raw.fetchFailed,
    buildingCount,
    heightSource: raw.heightSource,
    referenceAreaM2,
    referenceAreaSource,
    parcelleReference: useParcelle ? ctx.parcelle!.reference : null,
    footprintAreaM2: Math.round(footprintAreaM2),
    cesPct,
    cosApprox,
    heightCoveragePct,
    meanHeightM,
    orientationPct,
    dominantOrientation,
    risqueIlotChaleur,
  };
}

function computeRisque(
  cesPct: number,
  meanHeightM: number | null,
  buildingCount: number,
): RisqueIlotChaleur {
  if (buildingCount === 0) return "Indéterminé";
  if (cesPct < CES_LOW_PCT) return "Faible";
  if (meanHeightM === null) return "Modéré"; // densité connue, hauteur non fiable
  if (cesPct >= CES_HIGH_PCT && meanHeightM >= HEIGHT_HIGH_M) return "Élevé";
  return "Modéré";
}
