// Rendu écran du module Eau.
import { Chart } from "chart.js/auto";
import type { ChartConfiguration } from "chart.js";
import type { EauResult } from "./compute";
import { volumeMensuelConfig } from "./charts";
import { RUNOFF_COEFFICIENT, COLLECTION_EFFICIENCY } from "./compute";

function indicator(label: string, value: string): string {
  return `<div class="indicator"><span class="ind-value">${value}</span><span class="ind-label">${label}</span></div>`;
}

export function renderEau(el: HTMLElement, r: EauResult): void {
  const hasRoof = r.roofAreaM2 !== null;

  const piezoBlock = r.piezoFetchFailed
    ? `<p class="error">Service Hub'Eau (piézométrie) indisponible pour le moment.</p>`
    : r.piezo === null
      ? `<p class="module-note">Aucun piézomètre recensé dans un rayon de 15 km — pas de donnée
         de nappe disponible pour ce site.</p>`
      : `<p>Piézomètre le plus proche : <strong>${r.piezo.nomCommune ?? r.piezo.codeBss}</strong>
         (à ${(r.piezo.distanceM / 1000).toFixed(1)} km).
         ${
           r.piezo.profondeurNappeM !== null
             ? `Profondeur de la nappe : <strong>${r.piezo.profondeurNappeM.toFixed(1)} m</strong>
                (mesure du ${r.piezo.dateMesure ?? "n.d."}).`
             : "Dernière mesure non disponible."
         }</p>`;

  el.innerHTML = `
    <div class="indicators">
      ${indicator("Surface de toiture", hasRoof ? `${r.roofAreaM2} m²` : "n.d.")}
      ${indicator("Pluviométrie annuelle", `${r.annualPrecipMm} mm`)}
      ${indicator(
        "Volume récupérable / an",
        hasRoof ? `${(r.annualVolumeL! / 1000).toFixed(1)} m³` : "n.d.",
      )}
      ${indicator(
        "Profondeur nappe (indicative)",
        r.piezo?.profondeurNappeM != null ? `${r.piezo.profondeurNappeM.toFixed(1)} m` : "n.d.",
      )}
    </div>
    ${
      hasRoof
        ? `<div class="chart-box"><canvas data-chart="vol"></canvas></div>`
        : `<p class="error">Aucun bâtiment identifié dans OpenStreetMap à proximité
           du point recherché : le potentiel de récupération ne peut pas être
           estimé automatiquement. Vérifiez que le bâtiment est bien cadastré
           dans OSM, ou affinez les coordonnées.</p>`
    }
    <p class="module-note">Estimation : surface de toiture (OpenStreetMap) ×
    pluviométrie (normales Open-Meteo 1991-2020) × coefficient de ruissellement
    (${RUNOFF_COEFFICIENT}) × rendement de collecte (${COLLECTION_EFFICIENCY}).
    C'est un ordre de grandeur, pas un dimensionnement de cuve — l'emprise de
    toiture réelle peut différer du contour cadastré dans OSM.</p>

    <h3 class="module-subtitle">Nappe souterraine (piézométrie)</h3>
    ${piezoBlock}
    <p class="module-note">Source : Hub'Eau (BRGM/ADES). Piézomètre le plus proche dans un
    rayon de recherche de 15 km — les piézomètres sont rares, ce n'est jamais une mesure
    sur site, seulement l'indication disponible la plus proche. Utile pour une première
    lecture (infiltration, risque de nappe affleurante, fondations), pas pour une étude
    géotechnique.</p>
  `;

  if (hasRoof) {
    mountChart(el, "vol", volumeMensuelConfig(r));
  }
}

function mountChart(el: HTMLElement, key: string, config: ChartConfiguration): void {
  const canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-chart="${key}"]`);
  if (canvas) new Chart(canvas, config);
}
