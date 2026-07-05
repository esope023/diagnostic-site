// Module Climat — assemble le contrat DiagnosticModule.
// C'est LE gabarit de départ (voir README) : normales 1991-2020 + projections
// climatiques CMIP6 (horizons 2030/2050).
import type { DiagnosticModule, ExportBlock, SiteContext } from "../../core/types";
import { fetchClimatModule, type ClimatModuleRaw } from "./fetch";
import { computeClimat, computeProjectionHorizon, type ClimatResult } from "./compute";
import { renderClimat } from "./render";
import { tempPrecipConfig, rayonnementConfig, projectionsConfig } from "./charts";

export const climatModule: DiagnosticModule<ClimatModuleRaw, ClimatResult> = {
  id: "climat",
  label: "Climat",
  icon: "🌤",
  scope: "site",

  fetchData(ctx: SiteContext) {
    return fetchClimatModule(ctx);
  },

  compute(raw: ClimatModuleRaw) {
    const baseline = computeClimat(raw.baseline);
    const projections = raw.projections.map((p) =>
      computeProjectionHorizon(p.window.id, p.window.label, p.perModel, baseline),
    );
    return { ...baseline, projections };
  },

  render(el: HTMLElement, result: ClimatResult) {
    renderClimat(el, result);
  },

  toExport(result: ClimatResult): ExportBlock {
    const projectionNotes = result.projections.map((p) => {
      const pct = (v: number | null) => (v === null ? "n.d." : `${v > 0 ? "+" : ""}${v} %`);
      return (
        `${p.label} : temp. moyenne ${p.indicators.tMoyenneAnnuelle} °C ` +
        `(${p.deltaTemp > 0 ? "+" : ""}${p.deltaTemp} °C), nuits tropicales ` +
        `${p.indicators.nuitsTropicales} j/an (${pct(p.pctNuitsTropicales)}), ` +
        `jours ≥ 30 °C ${p.indicators.joursChaleur30} j/an (${pct(p.pctJours30)}), ` +
        `vagues de chaleur ${p.indicators.vaguesChaleur}/an (${pct(p.pctVagues)}).`
      );
    });

    return {
      moduleId: "climat",
      title: "Climat",
      summary:
        `Température moyenne annuelle de ${result.tMoyenneAnnuelle} °C, ` +
        `${result.nuitsTropicales} nuits tropicales et ${result.joursChaleur30} jours ` +
        `≥ 30 °C par an en moyenne (normales 1991-2020).` +
        (result.projections.length > 0
          ? ` Projection à l'horizon 2050 : ${result.projections[result.projections.length - 1].indicators.tMoyenneAnnuelle} °C en moyenne annuelle.`
          : ""),
      indicators: [
        { label: "Temp. moyenne annuelle", value: `${result.tMoyenneAnnuelle} °C` },
        { label: "DJU chauffage (base 18)", value: `${result.djuChauffage}` },
        { label: "DJU climatisation (base 18)", value: `${result.djuClim}` },
        { label: "Nuits tropicales / an", value: `${result.nuitsTropicales}` },
        { label: "Jours ≥ 30 °C / an", value: `${result.joursChaleur30}` },
        { label: "Jours ≥ 35 °C / an", value: `${result.joursChaleur35}` },
        ...result.projections.map((p) => ({
          label: `Temp. moyenne — ${p.label}`,
          value: `${p.indicators.tMoyenneAnnuelle} °C (${p.deltaTemp > 0 ? "+" : ""}${p.deltaTemp} °C)`,
        })),
      ],
      charts: [
        { title: "Températures et précipitations", config: tempPrecipConfig(result) },
        { title: "Rayonnement solaire mensuel", config: rayonnementConfig(result) },
        ...(result.projections.length > 0
          ? [
              {
                title: "Évolution nuits tropicales / jours de chaleur",
                config: projectionsConfig(result, result.projections),
              },
            ]
          : []),
      ],
      notes: [
        "Référence : Open-Meteo (réanalyse ERA5), période 1991-2020.",
        "DJU base 18 °C ; vague de chaleur simplifiée (≥ 3 j consécutifs Tmax ≥ 30 °C).",
        "Projections : Open-Meteo Climate API (CMIP6), moyenne d'un ensemble simplifié " +
          "de 3 modèles (couverture température complète). Pas de choix de scénario " +
          "d'émission possible : trajectoire proche de RCP8.5 jusqu'en 2050.",
        "Horizon 2050 = fin de la période disponible dans l'API (données jusqu'à 2050), " +
          "pas une valeur ponctuelle à cette date.",
        ...projectionNotes,
      ],
    };
  },
};
