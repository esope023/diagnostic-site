// Assemble l'entrée de la synthèse depuis les résultats déjà calculés par les
// modules (registre), et fournit le bloc d'export correspondant. Ne fetch
// rien : pure consommation de lastResults.
import { getResult } from "../core/module-registry";
import { computeSynthese, type SyntheseInput, type SyntheseResult } from "./rules";
import type { ClimatResult } from "../modules/climat/compute";
import type { VentResult } from "../modules/vent/compute";
import type { EauResult } from "../modules/eau/compute";
import type { NatureResult } from "../modules/nature/compute";
import type { UrbanismeResult } from "../modules/urbanisme/compute";
import type { SoleilResult } from "../modules/soleil/compute";
import type { ReglementaireResult } from "../modules/reglementaire/compute";
import type { MobilitesResult } from "../modules/mobilites/compute";
import type { ExportBlock } from "../core/types";

export function buildSyntheseInput(): SyntheseInput {
  return {
    climat: getResult<ClimatResult>("climat"),
    vent: getResult<VentResult>("vent"),
    eau: getResult<EauResult>("eau"),
    nature: getResult<NatureResult>("nature"),
    urbanisme: getResult<UrbanismeResult>("urbanisme"),
    soleil: getResult<SoleilResult>("soleil"),
    reglementaire: getResult<ReglementaireResult>("reglementaire"),
    mobilites: getResult<MobilitesResult>("mobilites"),
  };
}

export function synthesizeFromRegistry(): SyntheseResult {
  return computeSynthese(buildSyntheseInput());
}

export function syntheseToExportBlock(r: SyntheseResult): ExportBlock {
  const summary =
    r.enjeux.length === 0
      ? "Aucun enjeu déclenché par les règles de croisement pour ce site."
      : `${r.enjeux.length} enjeu(x) identifié(s), dont ${
          r.enjeux.filter((e) => e.niveau === "Déterminant").length
        } déterminant(s). Lecture croisée indicative — l'arbitrage reste au praticien.`;

  const indicators = r.enjeux.map((e) => ({ label: e.titre, value: `${e.niveau} (score ${e.score})` }));

  const notes: string[] = [];
  for (const e of r.enjeux) {
    const signauxTxt = e.signaux.map((s) => `${s.label} : ${s.valeur} [${s.moduleId}]`).join(" ; ");
    const leviersTxt = e.leviers.join(" ; ");
    notes.push(`${e.titre} — Signaux : ${signauxTxt}. Pistes : ${leviersTxt}.`);
    if (e.nonEvalues.length) notes.push(`${e.titre} — non évalué : ${e.nonEvalues.join(" ; ")}.`);
  }
  if (r.reglesNonEvaluables.length) {
    notes.push(`Enjeux non évaluables faute de données : ${r.reglesNonEvaluables.join(" · ")}.`);
  }
  notes.push(
    "Synthèse générée par des règles de croisement explicites et traçables (seuils écrits, " +
      "signaux sourcés module par module) — pas un modèle prédictif ni un jugement automatique.",
  );

  return {
    moduleId: "synthese",
    title: "Synthèse des enjeux",
    summary,
    indicators,
    charts: [],
    notes,
  };
}
