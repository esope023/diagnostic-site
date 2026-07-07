// Module Mobilités — assemble le contrat DiagnosticModule. Scope "quartier".
import type { DiagnosticModule, ExportBlock, SiteContext } from "../../core/types";
import { fetchMobilites, type MobilitesRaw } from "./fetch";
import { computeMobilites, MODE_LABELS, type MobilitesResult } from "./compute";
import { renderMobilites } from "./render";
import { cyclingConfig } from "./charts";

export const mobilitesModule: DiagnosticModule<MobilitesRaw, MobilitesResult> = {
  id: "mobilites",
  label: "Mobilités",
  icon: "🚲",
  scope: "quartier",

  fetchData(ctx: SiteContext) {
    return fetchMobilites(ctx);
  },

  compute(raw: MobilitesRaw) {
    return computeMobilites(raw);
  },

  render(el: HTMLElement, result: MobilitesResult) {
    renderMobilites(el, result);
  },

  toExport(result: MobilitesResult): ExportBlock {
    if (result.fetchFailed) {
      return {
        moduleId: "mobilites",
        title: "Mobilités",
        summary: "Données OpenStreetMap indisponibles au moment de la génération du rapport.",
        indicators: [],
        charts: [],
        notes: ["Le service Overpass n'a pas répondu ; à régénérer ultérieurement."],
      };
    }

    const totalCyclingKm = result.cyclingKmAmenagee + result.cyclingKmPartagee;
    const totalStops = Object.values(result.transitStopsByMode).reduce((a, b) => a + b, 0);

    return {
      moduleId: "mobilites",
      title: "Mobilités",
      summary:
        `${totalCyclingKm.toFixed(1)} km d'infrastructure cyclable (${result.cyclingDensityKmKm2} km/km²), ` +
        `${totalStops} arrêt(s) et ${result.transitLines.length} ligne(s) de transport en commun ` +
        `recensés dans le rayon analysé.`,
      indicators: [
        { label: "Infra cyclable aménagée", value: `${result.cyclingKmAmenagee.toFixed(1)} km` },
        { label: "Infra cyclable partagée", value: `${result.cyclingKmPartagee.toFixed(1)} km` },
        { label: "Infra cyclable en projet", value: `${result.cyclingKmProjet.toFixed(1)} km` },
        { label: "Densité cyclable", value: `${result.cyclingDensityKmKm2} km/km²` },
        { label: "Arrêts TC recensés", value: `${totalStops}` },
        { label: "Lignes TC recensées", value: `${result.transitLines.length}` },
        ...result.transitLines.map((l) => ({
          label: `Ligne ${MODE_LABELS[l.mode]}`,
          value: `${l.ref ?? ""} ${l.name ?? ""}`.trim() || "n.d.",
        })),
      ],
      charts: [{ title: "Infrastructure cyclable par catégorie", config: cyclingConfig(result) }],
      notes: [
        "Source : OpenStreetMap (Overpass), rayon défini par le cadrage d'analyse choisi.",
        "\"Aménagée\" = piste/site propre ; \"partagée\" = bande cyclable ou voie mixte.",
        "La catégorie \"en projet\" dépend du remplissage communautaire OSM — pas de source " +
          "nationale unifiée pour les tracés en projet des métropoles ; une absence ne " +
          "signifie pas qu'aucun projet n'existe.",
        "Transport en commun : arrêts et noms/numéros de lignes seulement, pas les tracés " +
          "précis (requête Overpass allégée).",
        "Strava volontairement exclu : CGU incompatibles avec une réutilisation hors de leurs " +
          "produits (heatmap globale, données individuelles sous OAuth, Metro réservé aux " +
          "collectivités partenaires).",
      ],
    };
  },
};
