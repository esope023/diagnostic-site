// Rendu écran du module Vent : indicateurs annuels + 4 roses saisonnières.
import { Chart } from "chart.js/auto";
import type { ChartConfiguration } from "chart.js";
import { SECTOR_LABELS, SEASONS, SEASON_LABELS, type VentResult } from "./compute";
import { roseConfig } from "./charts";

function indicator(label: string, value: string): string {
  return `<div class="indicator"><span class="ind-value">${value}</span><span class="ind-label">${label}</span></div>`;
}

export function renderVent(el: HTMLElement, r: VentResult): void {
  const dominantLabel = SECTOR_LABELS[r.annual.dominantSector];

  el.innerHTML = `
    <div class="indicators">
      ${indicator("Direction dominante", dominantLabel)}
      ${indicator("Vitesse moyenne", `${r.annual.meanSpeedOverall} m/s`)}
      ${indicator("Calme (< 0,5 m/s)", `${r.annual.calmPct} %`)}
    </div>
    <div class="rose-grid">
      ${SEASONS.map((s) => `<div class="chart-box rose-box"><canvas data-chart="rose-${s}"></canvas></div>`).join("")}
    </div>
    <p class="module-note">Roses calculées sur ${r.years} ans de données horaires
    (réanalyse ERA5, fenêtre récente — voir méthodologie dans l'export).
    16 secteurs de 22,5°. La couleur indique la vitesse moyenne du secteur,
    pas un empilement de classes de vitesse (approximation, pas une rose
    météorologique normée).</p>
  `;

  for (const s of SEASONS) {
    mountChart(el, `rose-${s}`, roseConfig(r.bySeason[s], SEASON_LABELS[s]));
  }
}

function mountChart(el: HTMLElement, key: string, config: ChartConfiguration): void {
  const canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-chart="${key}"]`);
  if (canvas) new Chart(canvas, config);
}
