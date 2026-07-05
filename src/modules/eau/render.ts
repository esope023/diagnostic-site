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

  el.innerHTML = `
    <div class="indicators">
      ${indicator("Surface de toiture", hasRoof ? `${r.roofAreaM2} m²` : "n.d.")}
      ${indicator("Pluviométrie annuelle", `${r.annualPrecipMm} mm`)}
      ${indicator(
        "Volume récupérable / an",
        hasRoof ? `${(r.annualVolumeL! / 1000).toFixed(1)} m³` : "n.d.",
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
  `;

  if (hasRoof) {
    mountChart(el, "vol", volumeMensuelConfig(r));
  }
}

function mountChart(el: HTMLElement, key: string, config: ChartConfiguration): void {
  const canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-chart="${key}"]`);
  if (canvas) new Chart(canvas, config);
}
