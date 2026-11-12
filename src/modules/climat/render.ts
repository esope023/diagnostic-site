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

    <h3 class="module-subtitle">Projections climatiques</h3>
    ${
      r.projections.length === 0
        ? `<p class="error">Projections indisponibles (service Open-Meteo Climate momentanément
           inaccessible). Ce n'est pas une absence d'évolution — réessayer plus tard.</p>`
        : `${headline(r)}
          <div class="projections-grid">
            ${r.projections
              .map(
                (p) => `
              <div class="projection-card">
                <h4>${p.label}</h4>
                <ul class="projection-list">
                  <li>Nuits tropicales : <strong>${p.indicators.nuitsTropicales} /an</strong>
                    (${fmtDelta(p.deltaNuitsTropicales, "")}) ${range(p.fourchette.nuitsTropicales)}</li>
                  <li>Jours ≥ 30 °C : <strong>${p.indicators.joursChaleur30} /an</strong>
                    (${fmtDelta(p.deltaJours30, "")}) ${range(p.fourchette.joursChaleur30)}</li>
                  <li>Temp. moyenne : <strong>${p.indicators.tMoyenneAnnuelle} °C</strong>
                    (${fmtDelta(p.deltaTemp, "°C")}) ${range(p.fourchette.tMoyenneAnnuelle, " °C")}</li>
                  <li>Besoins de chauffage : <strong>${p.indicators.djuChauffage} DJU</strong>
                    (${fmtPct(p.pctDjuChauffage)})</li>
                  <li>Besoins de rafraîchissement : <strong>${p.indicators.djuClim} DJU</strong>
                    (${fmtPct(p.pctDjuClim)})</li>
                  <li>Vagues de chaleur : <strong>${p.indicators.vaguesChaleur} /an</strong>
                    (${fmtDelta(p.deltaVagues, "")})</li>
                </ul>
              </div>`,
              )
              .join("")}
          </div>
          <div class="chart-box"><canvas data-chart="proj"></canvas></div>`
    }
    <p class="module-note">Projections : ${r.projections[0]?.nbModeles ?? 0} modèles climatiques à
    haute résolution (Open-Meteo Climate API, scénario d'émissions élevées, données jusqu'en 2050),
    à rapprocher de la trajectoire de référence française (TRACC : +2 °C en 2030, +2,7 °C en 2050).
    <strong>Méthode des écarts</strong> : chaque modèle est comparé à sa propre période 1991-2020,
    et cet écart est ajouté aux observations — utilisés tels quels, les modèles se trompent déjà
    sur le climat actuel du site, et ce biais serait pris pour du réchauffement. Entre
    parenthèses grises : fourchette entre modèles. « n.d. » sur un pourcentage : référence à 0.</p>
  `;

  mountChart(el, "tp", tempPrecipConfig(r));
  mountChart(el, "ray", rayonnementConfig(r));
  if (r.projections.length > 0) {
    mountChart(el, "proj", projectionsConfig(r, r.projections));
  }
}

/** Fourchette entre modèles, discrète, après la valeur moyenne. */
function range(f: { min: number; max: number }, unit = ""): string {
  if (!Number.isFinite(f.min) || f.min === f.max) return "";
  return `<span class="range">${f.min} à ${f.max}${unit}</span>`;
}

/** Phrase-titre à l'horizon 2050 : multiplication des nuits tropicales. */
function headline(r: ClimatResult): string {
  const h = r.projections.find((p) => p.id === "2050") ?? r.projections[r.projections.length - 1];
  if (!h || r.nuitsTropicales <= 0) return "";
  const ratio = h.indicators.nuitsTropicales / r.nuitsTropicales;
  const facteur = ratio >= 1.15 ? `×${(Math.round(ratio * 10) / 10).toString().replace(".", ",")}` : "";
  return `<div class="climat-headline">
    ${facteur ? `<span class="climat-facteur">${facteur}</span>` : ""}
    <p>À l'horizon 2050, environ <strong>${Math.round(h.indicators.nuitsTropicales)} nuits
    tropicales par an</strong>, contre ${Math.round(r.nuitsTropicales)} sur 1991-2020
    <span class="range">(fourchette ${Math.round(h.fourchette.nuitsTropicales.min)} à
    ${Math.round(h.fourchette.nuitsTropicales.max)})</span>.</p>
  </div>`;
}

function mountChart(el: HTMLElement, key: string, config: ChartConfiguration): void {
  const canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-chart="${key}"]`);
  if (canvas) new Chart(canvas, config);
}
