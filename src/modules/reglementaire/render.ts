// Rendu écran du module Réglementaire.
import type { ReglementaireResult } from "./compute";

function indicator(label: string, value: string): string {
  return `<div class="indicator"><span class="ind-value">${value}</span><span class="ind-label">${label}</span></div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Statut Géorisques mis en forme : « Risque Existant - important » → « Existant – important ». */
function statut(s: string | null): string {
  if (!s) return `<span class="module-note">n.d.</span>`;
  const t = s.replace(/^Risque\s+/i, "").replace(/\s+-\s+/, " – ");
  const fort = /existant|concerne$/i.test(t) && !/non\s+concern/i.test(t);
  return fort ? `<strong>${esc(t)}</strong>` : esc(t);
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
             ? `<a href="${esc(r.documentUrl)}" target="_blank" rel="noopener">Ouvrir le règlement de la zone ↗</a>`
             : `Lien vers le règlement non publié pour cette zone — à vérifier en mairie.`
         }</p>`
      : r.zonageFailed
        ? `<p class="error">Zonage indisponible : le Géoportail de l'Urbanisme (API Carto IGN) n'a
           pas répondu. Ce n'est pas une absence de PLU — réessayer plus tard.</p>`
      : `<p class="error">Aucun zonage trouvé sur le Géoportail de l'Urbanisme pour ce point.
         Cela ne signifie pas forcément l'absence de document d'urbanisme (couverture GPU incomplète,
         surtout en zone rurale) — à vérifier en mairie.</p>`;

  const supBlock =
    r.supCount === null
      ? `<p class="error">Servitudes d'utilité publique indisponibles (Géoportail de l'Urbanisme
         n'a pas répondu). Ce n'est pas une absence de servitude — réessayer plus tard.</p>`
      : r.supCount > 0
        ? `<ul class="reg-list">${r.supItems
            .map(
              (s) =>
                `<li>${esc(s.libelle ?? "Servitude")}${s.categorie ? ` (${esc(s.categorie)})` : ""}` +
                `${s.typeAssiette ? ` — <span class="module-note">${esc(s.typeAssiette)}</span>` : ""}</li>`,
            )
            .join("")}</ul>`
        : `<p class="module-note">Aucune servitude d'utilité publique détectée sur le Géoportail de
           l'Urbanisme pour ce point. Rappel : la totalité des SUP n'est pas encore publiée sur le
           GPU — une absence de résultat ne garantit pas leur absence réelle.</p>`;

  const naturels = r.risquesPresents.filter((f) => f.famille === "naturel");
  const technos = r.risquesPresents.filter((f) => f.famille === "technologique");
  const risqueRow = (f: (typeof r.risquesPresents)[number]) =>
    `<tr><td>${esc(f.libelle)}</td><td>${statut(f.statutAdresse)}</td><td>${statut(f.statutCommune)}</td></tr>`;
  const risqueTable = (titre: string, list: typeof r.risquesPresents) =>
    list.length === 0
      ? ""
      : `<table class="reg-table"><thead><tr><th>${titre}</th><th>À l'adresse</th><th>Commune</th></tr></thead>
         <tbody>${list.map(risqueRow).join("")}</tbody></table>`;

  const risquesBlock = !r.risquesDisponibles
    ? `<p class="error">Synthèse des risques Géorisques indisponible pour le moment (service
       instable par intermittence). Ce n'est pas une absence de risque — réessayer plus tard, ou
       consulter directement georisques.gouv.fr pour ce point.</p>`
    : r.risquesPresents.length > 0
      ? `${risqueTable("Risques naturels", naturels)}${risqueTable("Risques technologiques", technos)}
         <p class="module-note">« Inconnu » ou « non connu » à l'adresse signifie que le risque
         n'est pas qualifié à cet endroit précis, pas qu'il est absent.${
           r.georisquesUrl
             ? ` <a href="${esc(r.georisquesUrl)}" target="_blank" rel="noopener">Rapport Géorisques complet ↗</a>`
             : ""
         }</p>`
      : `<p class="module-note">Aucun risque signalé par la synthèse Géorisques pour ce point.</p>`;

  const catnatBlock =
    r.catnatCount === null
      ? `<p class="error">Arrêtés de catastrophe naturelle indisponibles (Géorisques n'a pas
         répondu). Ce n'est pas une absence d'arrêté — réessayer plus tard.</p>`
      : r.catnatCount > 0
        ? `<p>${r.catnatCount} arrêté(s) de catastrophe naturelle sur les communes situées à moins
           de 1 km (Géorisques / GASPAR). Les plus récents :</p>
           <ul class="reg-list">${r.catnatRecent
             .map(
               (c) =>
                 `<li>${esc(c.libelle_risque_jo ?? "Arrêté CatNat")} — ${esc(c.date_debut_evt ?? "")}` +
                 `${c.date_fin_evt && c.date_fin_evt !== c.date_debut_evt ? ` → ${esc(c.date_fin_evt)}` : ""}</li>`,
             )
             .join("")}</ul>`
        : `<p class="module-note">Aucun arrêté de catastrophe naturelle recensé sur les communes à
           moins de 1 km.</p>`;

  el.innerHTML = `
    <div class="indicators">
      ${indicator("Zonage", r.isRnu ? "RNU" : r.zonageLibelle ?? "n.d.")}
      ${indicator("Servitudes (SUP)", r.supCount === null ? "n.d." : `${r.supCount}`)}
      ${indicator("Exposition RGA", r.rgaExposition ?? "n.d.")}
      ${indicator("Risques existants à l'adresse", r.risquesDisponibles ? `${r.risquesAdresseCount}` : "n.d.")}
      ${indicator("Arrêtés CatNat (communes < 1 km)", r.catnatCount === null ? "n.d." : `${r.catnatCount}`)}
    </div>

    <h3 class="module-subtitle">Zonage PLU</h3>
    ${zonageBlock}

    <h3 class="module-subtitle">Servitudes d'utilité publique</h3>
    ${supBlock}

    <h3 class="module-subtitle">Retrait-gonflement des argiles (RGA)</h3>
    <p>${r.rgaExposition ? `Niveau : <strong>${esc(r.rgaExposition)}</strong> (code ${esc(r.rgaCode ?? "n.d.")}).` : "Donnée non disponible."}
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
