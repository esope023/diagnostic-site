// Rendu écran du module Climat : d'abord le climat futur (fiche graphique),
// puis le climat actuel (normales 1991-2020).
import { Chart } from "chart.js/auto";
import { moyennesAnnuelles, type ClimatResult, type AnneeObservee } from "./compute";
import { fetchObserve } from "./fetch";
import { tempPrecipConfig, rayonnementConfig } from "./charts";
import { headline, chiffresCles, trajectoires, calendrier, bandes } from "./fiche";
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
  const fiche =
    r.projections.length === 0
      ? `<p class="error">Projections indisponibles (service Open-Meteo Climate momentanément
         inaccessible). Ce n'est pas une absence d'évolution — réessayer plus tard.</p>`
      : `${headline(r)}
        ${chiffresCles(r)}
        <h3 class="module-subtitle">Trajectoires</h3>
        ${trajectoires(r)}
        <h3 class="module-subtitle">Calendrier des nuits tropicales <span class="sub-note">nuits par mois</span></h3>
        ${calendrier(r)}`;

  const details =
    r.projections.length === 0
      ? ""
      : `<details class="fiche-details">
        <summary>Tous les indicateurs par horizon</summary>
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
                <li>Jours ≥ 35 °C : <strong>${p.indicators.joursChaleur35} /an</strong>
                  ${range(p.fourchette.joursChaleur35)}</li>
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
      </details>`;

  el.innerHTML = `
    <p class="fiche-contexte">Horizons de la trajectoire de référence française (TRACC) :
    +2 °C en 2030, +2,7 °C en 2050.</p>
    ${fiche}
    <h3 class="module-subtitle">Réchauffement déjà observé <span class="sub-note">1950 – 2025 · mesures</span></h3>
    <div data-bandes>${bandes(undefined)}</div>
    ${details}

    <h3 class="module-subtitle">Climat actuel <span class="sub-note">normales 1991-2020</span></h3>
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

    <p class="module-note"><strong>Méthode.</strong> Projections : ${r.projections[0]?.nbModeles ?? 0} modèles
    climatiques à haute résolution (EC-Earth3P-HR, MRI-AGCM3-2-S, CMCC-CM2-VHR4 via Open-Meteo Climate API,
    scénario d'émissions élevées, données jusqu'en 2050). Chaque modèle est comparé à sa propre période
    1991-2020, et cet écart est ajouté aux observations (méthode des écarts) : utilisés tels quels, les
    modèles se trompent déjà sur le climat actuel du site, et ce biais serait pris pour du réchauffement.
    Les fourchettes donnent les valeurs extrêmes entre modèles. Bandes de réchauffement : réanalyse ERA5,
    moyennes annuelles.</p>
  `;

  mountChart(el, "tp", tempPrecipConfig(r));
  mountChart(el, "ray", rayonnementConfig(r));
  void chargerBandes(el, r);
}

/** Série observée 1950-2025, chargée après l'affichage de la fiche. */
async function chargerBandes(el: HTMLElement, r: ClimatResult): Promise<void> {
  const slot = el.querySelector<HTMLElement>("[data-bandes]");
  if (!slot) return;
  const raw = await fetchObserve(r.site);
  let obs: AnneeObservee[] | null = raw ? moyennesAnnuelles(raw.time, raw.temperature_2m_mean) : null;
  if (obs && obs.length < 30) obs = null;
  if (slot.isConnected) slot.innerHTML = bandes(obs);
}

/** Fourchette entre modèles, discrète, après la valeur moyenne. */
function range(f: { min: number; max: number }, unit = ""): string {
  if (!Number.isFinite(f.min) || f.min === f.max) return "";
  return `<span class="range">${f.min} à ${f.max}${unit}</span>`;
}

function mountChart(el: HTMLElement, key: string, config: ChartConfiguration): void {
  const canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-chart="${key}"]`);
  if (canvas) new Chart(canvas, config);
}
