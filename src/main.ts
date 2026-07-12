// Point d'entrée : câble la recherche, le rayon d'analyse, la carte,
// l'exécution des modules et l'export. Pour ajouter un module : l'importer,
// l'enregistrer ci-dessous, et déclarer sa portée ("site" ou "quartier").
import "leaflet/dist/leaflet.css";
import "./styles.css";
import L from "leaflet";

import type { SiteContext } from "./core/types";
import { buildSiteContext } from "./core/site-context";
import { RADIUS_PRESETS, DEFAULT_RADIUS_VALUE, radiusValueToMeters } from "./core/scope";
import {
  registerModule,
  getModules,
  runModule,
  collectExportBlocks,
  clearResults,
} from "./core/module-registry";
import { initMap, focusSite, updateAnalysisCircle, getMapElement } from "./map/map";
import { generateReport } from "./export/report";
import { synthesizeFromRegistry, syntheseToExportBlock } from "./synthese";
import { renderSynthese } from "./synthese/render";

// --- Correctif des icônes Leaflet sous bundler ------------------------------
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// --- Enregistrement des modules ---------------------------------------------
import { climatModule } from "./modules/climat";
import { ventModule } from "./modules/vent";
import { eauModule } from "./modules/eau";
import { natureModule } from "./modules/nature";
import { urbanismeModule } from "./modules/urbanisme";
import { soleilModule } from "./modules/soleil";
import { reglementaireModule } from "./modules/reglementaire";
import { mobilitesModule } from "./modules/mobilites";
registerModule(climatModule); // scope "site"
registerModule(ventModule); // scope "site"
registerModule(eauModule); // scope "site" (bâtiment, indépendant du rayon quartier)
registerModule(reglementaireModule); // scope "site" (zonage/SUP/risques propres au point)
registerModule(natureModule); // scope "quartier"
registerModule(urbanismeModule); // scope "quartier"
registerModule(soleilModule); // scope "quartier" (masques bâtis + héliodon 3D)
registerModule(mobilitesModule); // scope "quartier"

// --- Références DOM ----------------------------------------------------------
const form = document.getElementById("search-form") as HTMLFormElement;
const input = document.getElementById("search-input") as HTMLInputElement;
const radiusSelect = document.getElementById("radius-select") as HTMLSelectElement;
const modulesEl = document.getElementById("modules") as HTMLElement;
const siteInfoEl = document.getElementById("site-info") as HTMLElement;
const syntheseEl = document.getElementById("synthese") as HTMLElement;
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const mapContainer = document.getElementById("map") as HTMLElement;

let currentCtx: SiteContext | null = null;
/** Élément DOM du corps de chaque module, pour le rafraîchir sans tout reconstruire. */
const moduleBodies = new Map<string, HTMLElement>();

initMap(mapContainer);

// --- Sélecteur de rayon (peuplé depuis la source unique RADIUS_PRESETS) ----
for (const preset of RADIUS_PRESETS) {
  const opt = document.createElement("option");
  opt.value = preset.value;
  opt.textContent = preset.label;
  radiusSelect.appendChild(opt);
}
radiusSelect.value = DEFAULT_RADIUS_VALUE;

// --- Recherche ---------------------------------------------------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  modulesEl.innerHTML = "";
  moduleBodies.clear();
  modulesEl.insertAdjacentHTML("beforeend", `<p class="placeholder">Géocodage…</p>`);
  exportBtn.disabled = true;
  syntheseEl.hidden = true;
  clearResults();

  const radiusM = radiusValueToMeters(radiusSelect.value);
  const ctx = await buildSiteContext(query, radiusM);
  if (!ctx) {
    modulesEl.innerHTML = `<p class="error">Adresse introuvable.</p>`;
    return;
  }
  currentCtx = ctx;

  focusSite(ctx); // dessine aussi le cercle de rayon
  siteInfoEl.hidden = false;
  updateSiteInfo(ctx);

  modulesEl.innerHTML = "";
  await runModules(ctx);
  refreshSynthese();
  exportBtn.disabled = false;
});

// --- Changement de rayon : ne relance que les modules "quartier" -----------
radiusSelect.addEventListener("change", async () => {
  if (!currentCtx) return; // pas de site chargé, rien à recalculer
  currentCtx = { ...currentCtx, radiusM: radiusValueToMeters(radiusSelect.value) };
  updateAnalysisCircle(currentCtx);
  updateSiteInfo(currentCtx);
  await runModules(currentCtx, (m) => m.scope === "quartier");
  refreshSynthese();
});

/** Recalcule et affiche la synthèse des enjeux à partir des résultats déjà
 * en registre — ne relance aucun fetch, pure lecture croisée. */
function refreshSynthese(): void {
  const result = synthesizeFromRegistry();
  renderSynthese(syntheseEl, result);
  syntheseEl.hidden = false;
}

function updateSiteInfo(ctx: SiteContext): void {
  const alt = ctx.altitude !== null ? `${ctx.altitude} m` : "n.d.";
  const perimetre = ctx.radiusM !== null ? `périmètre ${ctx.radiusM} m` : "échelle parcelle";
  siteInfoEl.textContent = `${ctx.label} — altitude ${alt} — ${perimetre}`;
}

// --- Exécution des modules ---------------------------------------------------
async function runModules(
  ctx: SiteContext,
  filter: (m: ReturnType<typeof getModules>[number]) => boolean = () => true,
): Promise<void> {
  for (const mod of getModules()) {
    if (!filter(mod)) continue;

    let body = moduleBodies.get(mod.id);
    if (!body) {
      const card = document.createElement("section");
      card.className = "module-card";
      card.innerHTML = `<h2>${mod.icon ?? ""} ${mod.label}</h2><div class="module-body"></div>`;
      modulesEl.appendChild(card);
      body = card.querySelector<HTMLElement>(".module-body")!;
      moduleBodies.set(mod.id, body);
    }

    await runModule(mod, body, ctx, {
      onLoading: () => {
        body!.innerHTML = `<p class="placeholder">Chargement…</p>`;
      },
      onError: (message) => {
        body!.innerHTML = `<p class="error">Erreur : ${message}</p>`;
      },
    });
  }
}

// --- Export ------------------------------------------------------------------
exportBtn.addEventListener("click", async () => {
  if (!currentCtx) return;
  exportBtn.disabled = true;
  exportBtn.textContent = "Génération…";
  try {
    const syntheseBlock = syntheseToExportBlock(synthesizeFromRegistry());
    const blocks = [syntheseBlock, ...collectExportBlocks(currentCtx)];
    await generateReport(blocks, currentCtx, getMapElement());
  } finally {
    exportBtn.textContent = "Exporter le rapport (PDF)";
    exportBtn.disabled = false;
  }
});
