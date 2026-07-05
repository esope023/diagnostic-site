// Rendu écran du module Nature.
import { Chart } from "chart.js/auto";
import type { ChartConfiguration } from "chart.js";
import type { NatureResult } from "./compute";
import { occupationSolConfig } from "./charts";

function indicator(label: string, value: string): string {
  return `<div class="indicator"><span class="ind-value">${value}</span><span class="ind-label">${label}</span></div>`;
}

export function renderNature(el: HTMLElement, r: NatureResult): void {
  if (r.fetchFailed) {
    el.innerHTML = `<p class="error">Le service OpenStreetMap (Overpass) n'a pas répondu.
      Réessayez dans quelques instants — ce n'est pas un site sans verdure ni eau,
      simplement une donnée momentanément indisponible.</p>`;
    return;
  }

  const protectionBlock = r.protectedZonesFetchFailed
    ? `<p class="error">Service de zonages de protection (API Carto IGN) indisponible pour le
       moment. Réessayer plus tard — ce n'est pas une absence de protection confirmée.</p>`
    : r.protectedZones.length > 0
      ? `<ul class="reg-list">${r.protectedZones
          .map((z) => `<li>${z.label}${z.siteName ? ` — ${z.siteName}` : ""}</li>`)
          .join("")}</ul>`
      : `<p class="module-note">Aucun zonage de protection (Natura 2000, ZNIEFF, réserve, parc)
         détecté sur ce point précis.</p>`;

  el.innerHTML = `
    <div class="indicators">
      ${indicator("Surface végétalisée", `${r.greenPct} %`)}
      ${indicator("Surface en eau", `${r.waterPct} %`)}
      ${indicator("Canopée (bois/forêt)", `${r.canopyPct} %`)}
      ${indicator("Arbres recensés", `${r.treeCount}`)}
      ${indicator("Densité d'arbres", `${r.treeDensityHa} / ha`)}
      ${indicator("Zonages de protection", r.protectedZonesFetchFailed ? "n.d." : `${r.protectedZones.length}`)}
    </div>
    <div class="chart-box"><canvas data-chart="occ"></canvas></div>
    <p class="module-note">Données OpenStreetMap dans un rayon de
    ${r.effectiveRadiusM} m. Les polygones ne sont pas découpés au bord du
    cercle (Overpass renvoie l'objet entier dès qu'il touche le rayon) :
    les surfaces sont une estimation haute, pas une mesure exacte. La canopée
    ne compte que les bois/forêts cartographiés en polygone — les arbres isolés
    et petits jardins arborés sont sous-représentés. Les continuités
    écologiques réglementaires (trame verte/bleue SRCE) restent non intégrées
    (données régionales dédiées, hors périmètre ici).</p>

    <h3 class="module-subtitle">Zonages de protection réglementaires</h3>
    ${protectionBlock}
    <p class="module-note">Source : API Carto (module Nature, IGN/INPN). Vérifié sur le point
    précis recherché, pas sur l'ensemble du rayon "quartier" — une zone protégée peut commencer
    juste en dehors du point sans apparaître ici.</p>
  `;

  mountChart(el, "occ", occupationSolConfig(r));
}

function mountChart(el: HTMLElement, key: string, config: ChartConfiguration): void {
  const canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-chart="${key}"]`);
  if (canvas) new Chart(canvas, config);
}
