// Module Nature — assemble le contrat DiagnosticModule.
// Premier module de portée "quartier" : consomme ctx.radiusM directement
// dans sa requête Overpass (voir fetch.ts). Sert de gabarit pour Urbanisme.
import type { DiagnosticModule, ExportBlock, SiteContext } from "../../core/types";
import { fetchNature, type NatureRaw } from "./fetch";
import { computeNature, type NatureResult } from "./compute";
import { renderNature } from "./render";
import { occupationSolConfig } from "./charts";

export const natureModule: DiagnosticModule<NatureRaw, NatureResult> = {
  id: "nature",
  label: "Nature",
  icon: "🌳",
  scope: "quartier",

  fetchData(ctx: SiteContext) {
    return fetchNature(ctx);
  },

  compute(raw: NatureRaw) {
    return computeNature(raw);
  },

  render(el: HTMLElement, result: NatureResult) {
    renderNature(el, result);
  },

  toExport(result: NatureResult): ExportBlock {
    if (result.fetchFailed) {
      return {
        moduleId: "nature",
        title: "Nature",
        summary: "Données OpenStreetMap indisponibles au moment de la génération du rapport.",
        indicators: [],
        charts: [],
        notes: ["Le service Overpass n'a pas répondu ; à régénérer ultérieurement."],
      };
    }
    return {
      moduleId: "nature",
      title: "Nature",
      summary:
        `Dans un rayon de ${result.effectiveRadiusM} m : ${result.greenPct} % de surface ` +
        `végétalisée, ${result.waterPct} % de surface en eau, ${result.treeCount} arbres recensés. ` +
        (result.protectedZonesFetchFailed
          ? "Zonages de protection : non vérifiés (service indisponible)."
          : result.protectedZones.length > 0
            ? `${result.protectedZones.length} zonage(s) de protection sur le point (${result.protectedZones
                .map((z) => z.label)
                .join(", ")}).`
            : "Aucun zonage de protection détecté sur le point."),
      indicators: [
        { label: "Surface végétalisée", value: `${result.greenPct} %` },
        { label: "Surface en eau", value: `${result.waterPct} %` },
        { label: "Canopée (bois/forêt)", value: `${result.canopyPct} %` },
        { label: "Arbres recensés", value: `${result.treeCount}` },
        { label: "Densité d'arbres", value: `${result.treeDensityHa} / ha` },
        { label: "Rayon analysé", value: `${result.effectiveRadiusM} m` },
        {
          label: "Zonages de protection",
          value: result.protectedZonesFetchFailed ? "n.d." : `${result.protectedZones.length}`,
        },
      ],
      charts: [{ title: "Occupation du sol", config: occupationSolConfig(result) }],
      notes: [
        "Source végétalisation/eau : OpenStreetMap (Overpass), rayon défini par le cadrage choisi.",
        "Estimation haute : les polygones ne sont pas découpés au bord du rayon.",
        "Canopée limitée aux bois/forêts cartographiés en polygone (sous-estimation " +
          "probable des arbres isolés et jardins arborés).",
        "Zonages de protection (Natura 2000, ZNIEFF, réserves, parcs) : source API Carto " +
          "IGN/INPN, vérifiée sur le point précis, pas sur l'ensemble du rayon.",
        "Continuités écologiques réglementaires (trame verte/bleue, SRCE) non " +
          "intégrées : nécessitent les données régionales dédiées.",
      ],
    };
  },
};
