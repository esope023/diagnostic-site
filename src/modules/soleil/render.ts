// Rendu écran du module Soleil.
import { Chart } from "chart.js/auto";
import type { ChartConfiguration } from "chart.js";
import type { SoleilResult } from "./compute";
import { DEFAULT_HEIGHT_M, svfLabel } from "./compute";
import { masqueSolaireConfig, ensoleillementConfig, pvConfig } from "./charts";
import { mountHeliodon, type HeliodonHandle } from "./heliodon3d";
import type { SiteContext } from "../../core/types";
import { BUILDING_SOURCE_LABEL } from "../../core/buildings";
import { LEGACY_HELIODON_URL } from "../../api/endpoints";

function indicator(label: string, value: string): string {
  return `<div class="indicator"><span class="ind-value">${value}</span><span class="ind-label">${label}</span></div>`;
}

function legacyHeliodonLink(ctx: SiteContext): string {
  const url = new URL(LEGACY_HELIODON_URL);
  url.searchParams.set("addr", ctx.label);
  url.searchParams.set("lat", ctx.lat.toFixed(6));
  url.searchParams.set("lon", ctx.lon.toFixed(6));
  return url.toString();
}

/** Handle de l'héliodon actif, pour le disposer avant un nouveau rendu (changement de rayon). */
let activeHeliodon: HeliodonHandle | null = null;

export function renderSoleil(el: HTMLElement, r: SoleilResult, ctx: SiteContext): void {
  if (activeHeliodon) {
    activeHeliodon.dispose();
    activeHeliodon = null;
  }

  const pvAvailable = r.pv !== null && r.pv.annualKwhPerKwc !== null;

  el.innerHTML = `
    <div class="indicators">
      ${indicator("Bâtiments pris en compte", `${r.buildingCount}`)}
      ${indicator("Source des hauteurs", BUILDING_SOURCE_LABEL[r.heightSource])}
      ${indicator("Couverture données hauteur", `${r.heightCoveragePct} %`)}
      ${indicator("Ensoleillement annuel estimé", `${r.annualMaskedHours} h`)}
      ${indicator("Perte due aux masques", `${r.maskLossPct} %`)}
      ${indicator("Facteur de vue du ciel (SVF)", `${r.svf} — ${svfLabel(r.svf)}`)}
      ${indicator("Rayon analysé", `${r.effectiveRadiusM} m`)}
    </div>

    <h3 class="module-subtitle">Diagramme de masques</h3>
    <div class="chart-box"><canvas data-chart="masque"></canvas></div>

    <h3 class="module-subtitle">Durée d'ensoleillement mensuelle</h3>
    <div class="chart-box"><canvas data-chart="ensoleillement"></canvas></div>

    <h3 class="module-subtitle">Héliodon 3D</h3>
    <a class="heliodon-link" href="${legacyHeliodonLink(ctx)}" target="_blank" rel="noopener">
      Ouvrir l'héliodon complet (extrusion réelle, ombres portées, orthophoto, LiDAR) ↗
    </a>
    <div class="heliodon-container" data-heliodon></div>
    <p class="module-note">Aperçu simplifié ci-dessus (boîtes englobantes, sans
    ombres portées) — pour une lecture précise, utiliser le lien ci-dessus.
    ${r.trees.length} arbre(s) recensé(s) affiché(s) pour repère visuel (hauteur
    générique de 6 m — OSM ne fournit pas de hauteur d'arbre mesurée). Les arbres
    n'entrent pas dans le calcul du masque solaire ci-dessus, seuls les bâtiments
    y contribuent.</p>

    <h3 class="module-subtitle">Potentiel photovoltaïque</h3>
    ${
      pvAvailable
        ? `<div class="indicators">
             ${indicator("Production estimée / kWc installé", `${Math.round(r.pv!.annualKwhPerKwc!)} kWh/an`)}
           </div>
           <div class="chart-box"><canvas data-chart="pv"></canvas></div>`
        : `<p class="error">${
            r.pv === null
              ? "Estimation PV indisponible : le proxy PVGIS n'est pas configuré (voir README §Proxy PVGIS) ou le service n'a pas répondu."
              : "PVGIS n'a pas renvoyé de résultat exploitable pour ce site."
          }</p>`
    }

    <p class="module-note">Masque bâti calculé sur ${r.buildingCount} bâtiments
    (${BUILDING_SOURCE_LABEL[r.heightSource]}), hauteur connue pour ${r.heightCoveragePct} %
    d'entre eux (hypothèse de ${DEFAULT_HEIGHT_M} m appliquée aux autres). Masque
    échantillonné aux sommets des bâtiments en secteurs de 10° : approximation,
    pas une silhouette exacte. Durée d'ensoleillement calculée sur le 15 de
    chaque mois (jour représentatif) et ne tient compte que des masques bâtis
    — la nébulosité réelle est dans le module Climat (rayonnement), à lire en
    complément. SVF (facteur de vue du ciel) calculé avec la formule d'Oke à
    partir du même masque bâti : c'est une valeur au point du site, pas une
    carte, et elle ne tient pas compte du relief ni de la végétation. Potentiel
    PV : système fictif de 3 kWc, orientation/inclinaison optimales, pertes
    système 14 % (hypothèses PVGIS standard) — à ajuster à un projet réel.</p>
  `;

  mountChart(el, "masque", masqueSolaireConfig(r));
  mountChart(el, "ensoleillement", ensoleillementConfig(r));
  if (pvAvailable) mountChart(el, "pv", pvConfig(r.pv!.monthlyKwhPerKwc!));

  const heliodonEl = el.querySelector<HTMLElement>("[data-heliodon]");
  if (heliodonEl) {
    activeHeliodon = mountHeliodon(heliodonEl, r.buildings, r.trees, ctx, DEFAULT_HEIGHT_M);
  }
}

function mountChart(el: HTMLElement, key: string, config: ChartConfiguration): void {
  const canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-chart="${key}"]`);
  if (canvas) new Chart(canvas, config);
}
