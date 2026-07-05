// Rendu écran du module Climat.
import { Chart } from "chart.js/auto";
import type { ClimatResult } from "./compute";
import { tempPrecipConfig, rayonnementConfig, projectionsConfig } from "./charts";
import type { ChartConfiguration } from "chart.js";

function indicator(label: string, value: string): string {
  return `<div class="indicator"><span class="ind-value">${value}</span><span class="ind-label">${label}</span></div>`;
}

function fmtDelta(v: number, unit: string): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v} ${unit}`;
}
function fmtPct(v: number | null): string {
  if (v === null) return "n.d. (référence nulle)";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v} %`;
}

export function renderClimat(el: HTMLElement, r: ClimatResult): void {
  el.innerHTML = `
    <div class="indicators">
      ${indicator("Temp. moy. annuelle", `${r.tMoyenneAnnuelle} °C`)}
      ${indicator("DJU chauffage", `${r.djuChauffage}`)}
      ${indicator("Nuits tropicales / an", `${r.nuitsTropicales}`)}
      ${indicator("Jours ≥ 30 °C / an", `${r.joursChaleur30}`)}
      ${indicator("Jours ≥ 35 °C / an", `${r.joursChaleur35}`)}
      ${indicator("Vagues de chaleur / an", `${r.vaguesChaleur}`)}
    </div>
    <div class="chart-box"><canvas data-chart="tp"></canvas></div>
    <div class="chart-box"><canvas data-chart="ray"></canvas></div>
    <p class="module-note">Normales calculées sur ${r.years} ans (réanalyse ERA5,
    période 1991-2020). DJU base 18 °C. Vague de chaleur = ≥ 3 jours consécutifs
    à Tmax ≥ 30 °C (définition simplifiée).</p>

    <h3 class="module-subtitle">Projections climatiques (CMIP6)</h3>
    ${
      r.projections.length === 0
        ? `<p class="error">Projections indisponibles (service Open-Meteo Climate momentanément inaccessible).</p>`
        : `<div class="projections-grid">
            ${r.projections
              .map(
                (p) => `
              <div class="projection-card">
                <h4>${p.label}</h4>
                <ul class="projection-list">
                  <li>Temp. moyenne : <strong>${p.indicators.tMoyenneAnnuelle} °C</strong>
                    (${fmtDelta(p.deltaTemp, "°C")})</li>
                  <li>Nuits tropicales : <strong>${p.indicators.nuitsTropicales} j/an</strong>
                    (${fmtDelta(p.deltaNuitsTropicales, "j")}, ${fmtPct(p.pctNuitsTropicales)})</li>
                  <li>Jours ≥ 30 °C : <strong>${p.indicators.joursChaleur30} j/an</strong>
                    (${fmtDelta(p.deltaJours30, "j")}, ${fmtPct(p.pctJours30)})</li>
                  <li>Vagues de chaleur : <strong>${p.indicators.vaguesChaleur} /an</strong>
                    (${fmtDelta(p.deltaVagues, "")}, ${fmtPct(p.pctVagues)})</li>
                </ul>
              </div>`,
              )
              .join("")}
          </div>
          <div class="chart-box"><canvas data-chart="proj"></canvas></div>`
    }
    <p class="module-note">Projections CMIP6 (Open-Meteo Climate API), moyenne de
    ${r.projections[0]?.indicators ? 3 : 0} modèles à couverture complète en température
    (ensemble simplifié, pas les 7 modèles disponibles). Horizon 2050 = fin de période
    disponible (l'API s'arrête en 2050), pas une valeur ponctuelle à cette date précise.
    Pas de choix de scénario d'émission possible : trajectoire proche de RCP8.5 jusqu'en
    2050. Écarts calculés avec exactement la même méthode que la référence 1991-2020.
    "n.d." sur un pourcentage signifie une référence à 0 (le phénomène apparaîtrait,
    un % n'aurait pas de sens).</p>
  `;

  mountChart(el, "tp", tempPrecipConfig(r));
  mountChart(el, "ray", rayonnementConfig(r));
  if (r.projections.length > 0) {
    mountChart(el, "proj", projectionsConfig(r, r.projections));
  }
}

function mountChart(el: HTMLElement, key: string, config: ChartConfiguration): void {
  const canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-chart="${key}"]`);
  if (canvas) new Chart(canvas, config);
}
