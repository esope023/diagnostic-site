// Rendu écran du module Réglementaire.
import type { ReglementaireResult } from "./compute";

function indicator(label: string, value: string): string {
  return `<div class="indicator"><span class="ind-value">${value}</span><span class="ind-label">${label}</span></div>`;
}

function fmtDate(d?: string): string {
  if (!d) return "";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString("fr-FR");
}

export function renderReglementaire(el: HTMLElement, r: ReglementaireResult): void {
  const zonageBlock = r.isRnu
    ? `<p><strong>Règlement National d'Urbanisme (RNU)</strong> — cette commune n'a pas de PLU
       communal publié sur le Géoportail de l'Urbanisme. Les règles de constructibilité relèvent
       du RNU (Code de l'urbanisme) ; se renseigner en mairie pour les règles locales complémentaires.</p>`
    : r.zonageLibelle
      ? `<p>Zone <strong>${r.zonageLibelle}</strong>${r.zonageType ? ` (type ${r.zonageType})` : ""}.
         ${
           r.documentUrl
             ? `<a href="${r.documentUrl}" target="_blank" rel="noopener">Ouvrir le règlement / document d'urbanisme ↗</a>`
             : `Lien vers le règlement non disponible — à vérifier en mairie.`
         }</p>`
      : `<p class="error">Aucun zonage trouvé sur le Géoportail de l'Urbanisme pour ce point.
         Cela ne signifie pas forcément l'absence de document d'urbanisme (couverture GPU incomplète,
         surtout en zone rurale) — à vérifier en mairie.</p>`;

  const supBlock =
    r.supCount > 0
      ? `<ul class="reg-list">${r.supItems
          .map((s) => `<li>${s.libelle ?? "Servitude"}${s.categorie ? ` (${s.categorie})` : ""}</li>`)
          .join("")}</ul>`
      : `<p class="module-note">Aucune servitude d'utilité publique détectée sur le Géoportail de
         l'Urbanisme pour ce point. Rappel : la totalité des SUP n'est pas encore publiée sur le
         GPU — une absence de résultat ne garantit pas leur absence réelle.</p>`;

  const risquesBlock = !r.risquesDisponibles
    ? `<p class="error">Synthèse des risques Géorisques indisponible pour le moment (service
       instable par intermittence). Réessayer plus tard, ou consulter directement
       georisques.gouv.fr pour ce point.</p>`
    : r.risquesPresents.length > 0
      ? `<ul class="reg-list">${r.risquesPresents.map((f) => `<li>${f.libelle}</li>`).join("")}</ul>`
      : `<p class="module-note">Aucun risque signalé par la synthèse Géorisques pour ce point.</p>`;

  const catnatBlock =
    r.catnatCount > 0
      ? `<p>${r.catnatCount} arrêté(s) de catastrophe naturelle recensé(s) dans un rayon de 1 km
         (Géorisques/GASPAR). Les plus récents :</p>
         <ul class="reg-list">${r.catnatRecent
           .map((c) => `<li>${c.libelle ?? "Arrêté CatNat"} — ${fmtDate(c.dateDebut)} → ${fmtDate(c.dateFin)}</li>`)
           .join("")}</ul>`
      : `<p class="module-note">Aucun arrêté de catastrophe naturelle recensé dans un rayon de 1 km.</p>`;

  el.innerHTML = `
    <div class="indicators">
      ${indicator("Zonage", r.isRnu ? "RNU" : r.zonageLibelle ?? "n.d.")}
      ${indicator("Servitudes (SUP)", `${r.supCount}`)}
      ${indicator("Exposition RGA", r.rgaExposition ?? "n.d.")}
      ${indicator("Risques signalés", r.risquesDisponibles ? `${r.risquesPresents.length}` : "n.d.")}
      ${indicator("Arrêtés CatNat (1 km)", `${r.catnatCount}`)}
    </div>

    <h3 class="module-subtitle">Zonage PLU</h3>
    ${zonageBlock}

    <h3 class="module-subtitle">Servitudes d'utilité publique</h3>
    ${supBlock}

    <h3 class="module-subtitle">Retrait-gonflement des argiles (RGA)</h3>
    <p>${r.rgaExposition ? `Exposition <strong>${r.rgaExposition}</strong> (code ${r.rgaCode}).` : "Donnée non disponible."}
    Concerne directement les fondations — une exposition moyenne/forte implique généralement une
    étude géotechnique G1/G2 (loi ÉLAN) pour une maison individuelle.</p>

    <h3 class="module-subtitle">Autres risques (synthèse Géorisques)</h3>
    ${risquesBlock}

    <h3 class="module-subtitle">Historique catastrophes naturelles</h3>
    ${catnatBlock}

    <p class="module-note">Sources : Géoportail de l'Urbanisme (via API Carto IGN), Géorisques (BRGM /
    Ministère de la Transition écologique). Informations à visée de diagnostic amont — seule la
    mairie et les services de l'État font foi pour l'instruction d'un dossier réel. Le zonage
    affiché correspond au point recherché, pas nécessairement à l'ensemble de la parcelle si
    celle-ci est à cheval sur deux zones.</p>
  `;
}
