// Module Vent — assemble le contrat DiagnosticModule.
import type { DiagnosticModule, ExportBlock, SiteContext } from "../../core/types";
import { fetchVent, type VentRaw } from "./fetch";
import { computeVent, SECTOR_LABELS, SEASONS, SEASON_LABELS, type VentResult } from "./compute";
import { renderVent } from "./render";
import { roseConfig } from "./charts";

export const ventModule: DiagnosticModule<VentRaw, VentResult> = {
  id: "vent",
  label: "Vent",
  icon: "🌬",
  scope: "site",

  fetchData(ctx: SiteContext) {
    return fetchVent(ctx);
  },

  compute(raw: VentRaw) {
    return computeVent(raw);
  },

  render(el: HTMLElement, result: VentResult) {
    renderVent(el, result);
  },

  toExport(result: VentResult): ExportBlock {
    const dominantLabel = SECTOR_LABELS[result.annual.dominantSector];
    return {
      moduleId: "vent",
      title: "Vent",
      summary:
        `Direction dominante ${dominantLabel}, vitesse moyenne ` +
        `${result.annual.meanSpeedOverall} m/s (calme ${result.annual.calmPct} % du temps), ` +
        `sur ${result.years} ans de données horaires.`,
      indicators: [
        { label: "Direction dominante", value: dominantLabel },
        { label: "Vitesse moyenne annuelle", value: `${result.annual.meanSpeedOverall} m/s` },
        { label: "Calme (< 0,5 m/s)", value: `${result.annual.calmPct} %` },
      ],
      charts: SEASONS.map((s) => ({
        title: `Rose des vents — ${SEASON_LABELS[s]}`,
        config: roseConfig(result.bySeason[s], SEASON_LABELS[s]),
      })),
      notes: [
        "Source : Open-Meteo (réanalyse ERA5), données horaires sur 10 ans (fenêtre récente).",
        "16 secteurs de 22,5° ; couleur = vitesse moyenne du secteur (approximation, " +
          "pas une rose météorologique normée à classes de vitesse empilées).",
        "Les accélérations locales et l'effet canyon dépendent de la morphologie " +
          "bâtie et ne sont pas calculés ici (nécessitent une simulation CFD).",
      ],
    };
  },
};
