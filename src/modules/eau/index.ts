// Module Eau — assemble le contrat DiagnosticModule.
import type { DiagnosticModule, ExportBlock, SiteContext } from "../../core/types";
import { fetchEau, type EauRaw } from "./fetch";
import { computeEau, type EauResult, RUNOFF_COEFFICIENT, COLLECTION_EFFICIENCY } from "./compute";
import { renderEau } from "./render";
import { volumeMensuelConfig } from "./charts";

export const eauModule: DiagnosticModule<EauRaw, EauResult> = {
  id: "eau",
  label: "Eau",
  icon: "💧",
  scope: "site",

  fetchData(ctx: SiteContext) {
    return fetchEau(ctx);
  },

  compute(raw: EauRaw, ctx: SiteContext) {
    return computeEau(raw, ctx);
  },

  render(el: HTMLElement, result: EauResult) {
    renderEau(el, result);
  },

  toExport(result: EauResult): ExportBlock {
    const hasRoof = result.roofAreaM2 !== null;
    const piezoStr =
      result.piezo?.profondeurNappeM != null
        ? ` Nappe la plus proche à ${(result.piezo.distanceM / 1000).toFixed(1)} km : ` +
          `profondeur ${result.piezo.profondeurNappeM.toFixed(1)} m.`
        : "";
    return {
      moduleId: "eau",
      title: "Eau",
      summary:
        (hasRoof
          ? `Toiture d'environ ${result.roofAreaM2} m² pour ${result.annualPrecipMm} mm/an ` +
            `de pluie : potentiel de récupération estimé à ${(result.annualVolumeL! / 1000).toFixed(1)} m³/an.`
          : `Aucun bâtiment identifié dans OpenStreetMap à proximité : potentiel de ` +
            `récupération non estimable automatiquement (pluviométrie : ${result.annualPrecipMm} mm/an).`) +
        piezoStr,
      indicators: [
        { label: "Surface de toiture", value: hasRoof ? `${result.roofAreaM2} m²` : "n.d." },
        { label: "Pluviométrie annuelle", value: `${result.annualPrecipMm} mm` },
        {
          label: "Volume récupérable / an",
          value: hasRoof ? `${(result.annualVolumeL! / 1000).toFixed(1)} m³` : "n.d.",
        },
        {
          label: "Profondeur nappe (indicative)",
          value: result.piezo?.profondeurNappeM != null ? `${result.piezo.profondeurNappeM.toFixed(1)} m` : "n.d.",
        },
      ],
      charts: hasRoof
        ? [{ title: "Volume mensuel récupérable", config: volumeMensuelConfig(result) }]
        : [],
      notes: [
        "Estimation récupération EP : surface de toiture (OpenStreetMap) × pluviométrie " +
          `(Open-Meteo, normales 1991-2020) × coefficient de ruissellement (${RUNOFF_COEFFICIENT}) ` +
          `× rendement de collecte (${COLLECTION_EFFICIENCY}).`,
        "Ordre de grandeur, pas un dimensionnement de cuve : l'emprise cadastrée dans " +
          "OSM peut différer de la toiture réelle (débords, annexes non répertoriées).",
        "Piézométrie : Hub'Eau (BRGM/ADES), piézomètre le plus proche dans un rayon de " +
          "15 km — indicatif, pas une mesure sur site ni une étude géotechnique.",
      ],
    };
  },
};
