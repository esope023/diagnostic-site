// Rendu écran du module Mobilités.
import { Chart } from "chart.js/auto";
import type { ChartConfiguration } from "chart.js";
import { MODE_LABELS, type MobilitesResult } from "./compute";
import { cyclingConfig } from "./charts";

function indicator(label: string, value: string): string {
  return `<div class="indicator"><span class="ind-value">${value}</span><span class="ind-label">${label}</span></div>`;
}

export function renderMobilites(el: HTMLElement, r: MobilitesResult): void {
  if (r.fetchFailed) {
    el.innerHTML = `<p class="error">Le service OpenStreetMap (Overpass) n'a pas répondu.
      Réessayez dans quelques instants.</p>`;
    return;
  }

  const totalCyclingKm = r.cyclingKmAmenagee + r.cyclingKmPartagee;
  const totalStops = Object.values(r.transitStopsByMode).reduce((a, b) => a + b, 0);

  const stopsList = (Object.keys(MODE_LABELS) as (keyof typeof MODE_LABELS)[])
    .filter((m) => r.transitStopsByMode[m] > 0)
    .map((m) => `<li>${MODE_LABELS[m]} : ${r.transitStopsByMode[m]} arrêt(s)</li>`)
    .join("");

  const linesList = r.transitLines.length
    ? `<ul class="reg-list">${r.transitLines
        .map((l) => `<li>${MODE_LABELS[l.mode]} ${l.ref ? `<strong>${l.ref}</strong>` : ""} ${l.name ?? ""}</li>`)
        .join("")}</ul>`
    : `<p class="module-note">Aucune ligne de transport en commun recensée dans le rayon analysé.</p>`;

  el.innerHTML = `
    <div class="indicators">
      ${indicator("Infra cyclable (aménagée+partagée)", `${totalCyclingKm.toFixed(1)} km`)}
      ${indicator("Densité cyclable", `${r.cyclingDensityKmKm2} km/km²`)}
      ${indicator("En projet (couverture OSM inégale)", `${r.cyclingKmProjet.toFixed(1)} km`)}
      ${indicator("Arrêts TC recensés", `${totalStops}`)}
      ${indicator("Lignes TC recensées", `${r.transitLines.length}`)}
    </div>

    <h3 class="module-subtitle">Infrastructure cyclable</h3>
    <div class="chart-box"><canvas data-chart="cycling"></canvas></div>
    <p class="module-note">Source : OpenStreetMap (Overpass). "Aménagée" = piste/site propre
    (<code>highway=cycleway</code>) ; "partagée" = bande cyclable ou voie mixte sur chaussée
    partagée avec la circulation générale. La catégorie "en projet" dépend entièrement du
    remplissage communautaire d'OSM — contrairement au reste, il n'existe pas de source
    nationale unifiée pour les tracés en projet des métropoles : une absence ici ne signifie
    pas qu'aucun projet n'existe.</p>

    <h3 class="module-subtitle">Transport en commun</h3>
    ${totalStops > 0 ? `<ul class="reg-list">${stopsList}</ul>` : `<p class="module-note">Aucun arrêt recensé dans le rayon analysé.</p>`}
    ${linesList}
    <p class="module-note">Source : OpenStreetMap (Overpass). Les tracés précis des lignes ne
    sont pas affichés (seuls les arrêts et le nom/numéro des lignes), pour rester léger — les
    relations OSM complètes demanderaient une requête plus lourde.</p>
  `;

  mountChart(el, "cycling", cyclingConfig(r));
}

function mountChart(el: HTMLElement, key: string, config: ChartConfiguration): void {
  const canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-chart="${key}"]`);
  if (canvas) new Chart(canvas, config);
}
