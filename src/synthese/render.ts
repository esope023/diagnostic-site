// Rendu écran de la synthèse des enjeux.
import type { SyntheseResult, Enjeu, NiveauEnjeu } from "./rules";

const NIVEAU_CLASS: Record<NiveauEnjeu, string> = {
  "Déterminant": "niveau-determinant",
  "Important": "niveau-important",
  "À surveiller": "niveau-surveiller",
};

function enjeuCard(e: Enjeu): string {
  const signauxList = e.signaux
    .map((s) => `<li><strong>${s.label}</strong> — ${s.valeur} <span class="signal-source">(${s.moduleId})</span></li>`)
    .join("");
  const leviersList = e.leviers.map((l) => `<li>${l}</li>`).join("");
  const nonEvalues = e.nonEvalues.length
    ? `<p class="synthese-nonevalue">Non évalué : ${e.nonEvalues.join(" ; ")}</p>`
    : "";

  return `
    <article class="enjeu-card ${NIVEAU_CLASS[e.niveau]}">
      <div class="enjeu-header">
        <span class="enjeu-niveau">${e.niveau}</span>
        <h3>${e.titre}</h3>
      </div>
      <ul class="enjeu-signaux">${signauxList}</ul>
      ${nonEvalues}
      <details class="enjeu-leviers">
        <summary>Pistes de conception à arbitrer</summary>
        <ul>${leviersList}</ul>
      </details>
    </article>
  `;
}

export function renderSynthese(el: HTMLElement, r: SyntheseResult): void {
  if (r.enjeux.length === 0) {
    el.innerHTML = `
      <h2>Synthèse des enjeux</h2>
      <p class="module-note">Aucun enjeu déclenché par les règles de croisement pour ce site
      (ou données encore insuffisantes — vérifier que les modules ont bien chargé).</p>
    `;
    return;
  }

  el.innerHTML = `
    <h2>Synthèse des enjeux</h2>
    <p class="synthese-disclaimer">Lecture croisée indicative, générée par des règles explicites
    et traçables (voir la source de chaque signal) — pas un jugement automatique. L'arbitrage et
    la hiérarchisation finale restent au praticien.</p>
    <div class="enjeux-grid">${r.enjeux.map(enjeuCard).join("")}</div>
    ${
      r.reglesNonEvaluables.length > 0
        ? `<p class="synthese-nonevalue">Enjeux non évaluables faute de données : ${r.reglesNonEvaluables.join(" · ")}</p>`
        : ""
    }
  `;
}
