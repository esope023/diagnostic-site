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
    return {
      moduleId: "eau",
      title: "Eau",
      summary: hasRoof
        ? `Toiture d'environ ${result.roofAreaM2} m² pour ${result.annualPrecipMm} mm/an ` +
          `de pluie : potentiel de récupération estimé à ${(result.annualVolumeL! / 1000).toFixed(1)} m³/an.`
        : `Aucun bâtiment identifié dans OpenStreetMap à proximité : potentiel de ` +
          `récupération non estimable automatiquement (pluviométrie : ${result.annualPrecipMm} mm/an).`,
      indicators: [
        { label: "Surface de toiture", value: hasRoof ? `${result.roofAreaM2} m²` : "n.d." },
        { label: "Pluviométrie annuelle", value: `${result.annualPrecipMm} mm` },
        {
          label: "Volume récupérable / an",
          value: hasRoof ? `${(result.annualVolumeL! / 1000).toFixed(1)} m³` : "n.d.",
        },
      ],
      charts: hasRoof
        ? [{ title: "Volume mensuel récupérable", config: volumeMensuelConfig(result) }]
        : [],
      notes: [
        "Estimation : surface de toiture (OpenStreetMap) × pluviométrie (Open-Meteo, " +
          "normales 1991-2020) × coefficient de ruissellement " +
          `(${RUNOFF_COEFFICIENT}) × rendement de collecte (${COLLECTION_EFFICIENCY}).`,
        "Ordre de grandeur, pas un dimensionnement de cuve : l'emprise cadastrée dans " +
          "OSM peut différer de la toiture réelle (débords, annexes non répertoriées).",
      ],
    };
  },
};
