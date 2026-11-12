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

/** Repliée ou non : conservé d'une analyse à l'autre pendant la session. */
let open = true;

const BADGE: Record<NiveauEnjeu, [string, string]> = {
  "Déterminant": ["déterminant", "déterminants"],
  "Important": ["important", "importants"],
  "À surveiller": ["à surveiller", "à surveiller"],
};

function badges(r: SyntheseResult): string {
  return (Object.keys(BADGE) as NiveauEnjeu[])
    .map((n) => {
      const k = r.enjeux.filter((e) => e.niveau === n).length;
      if (k === 0) return "";
      return `<span class="badge ${NIVEAU_CLASS[n]}">${k} ${BADGE[n][k > 1 ? 1 : 0]}</span>`;
    })
    .join("");
}

export function renderSynthese(el: HTMLElement, r: SyntheseResult): void {
  const body =
    r.enjeux.length === 0
      ? `<p class="module-note">Aucun enjeu déclenché par les règles de croisement pour ce site
        (ou données encore insuffisantes — vérifier que les modules ont bien chargé).</p>`
      : `<p class="synthese-disclaimer">Lecture croisée indicative, générée par des règles explicites
        et traçables (voir la source de chaque signal) — pas un jugement automatique. L'arbitrage et
        la hiérarchisation finale restent au praticien.</p>
        <div class="enjeux-grid">${r.enjeux.map(enjeuCard).join("")}</div>
        ${
          r.reglesNonEvaluables.length > 0
            ? `<p class="synthese-nonevalue">Enjeux non évaluables faute de données : ${r.reglesNonEvaluables.join(" · ")}</p>`
            : ""
        }`;

  el.innerHTML = `
    <h2 class="synthese-heading">
      <button type="button" class="synthese-toggle" aria-controls="synthese-body">
        <span class="synthese-title">Synthèse des enjeux</span>
        <span class="synthese-sub">Règles croisées · sources traçables</span>
        <span class="synthese-badges">${badges(r)}</span>
        <span class="chevron" aria-hidden="true"></span>
      </button>
    </h2>
    <div class="synthese-body" id="synthese-body">${body}</div>
  `;
  const btn = el.querySelector<HTMLButtonElement>(".synthese-toggle")!;
  const bodyEl = el.querySelector<HTMLElement>(".synthese-body")!;
  const paint = () => {
    btn.setAttribute("aria-expanded", String(open));
    bodyEl.hidden = !open;
    el.classList.toggle("collapsed", !open);
  };
  btn.addEventListener("click", () => {
    open = !open;
    paint();
  });
  paint();
}
