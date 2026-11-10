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
import { attachAddressAutocomplete } from "./ui/address-autocomplete";

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

// --- Autocomplétion de l'adresse ---------------------------------------------
const addressAutocomplete = attachAddressAutocomplete(input, {
  // Oriente les suggestions vers le dernier site analysé.
  near: () => (currentCtx ? { lat: currentCtx.lat, lon: currentCtx.lon } : null),
});

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
  const preset = addressAutocomplete.getSelection();
  addressAutocomplete.close();

  modulesEl.innerHTML = "";
  moduleBodies.clear();
  modulesToolbar.hidden = true;
  modulesEl.insertAdjacentHTML("beforeend", `<p class="placeholder">Géocodage…</p>`);
  exportBtn.disabled = true;
  syntheseEl.hidden = true;
  clearResults();

  const radiusM = radiusValueToMeters(radiusSelect.value);
  const ctx = await buildSiteContext(query, radiusM, preset);
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
      body = createModuleCard(mod.id, `${mod.icon ?? ""} ${mod.label}`);
      moduleBodies.set(mod.id, body);
    }
    const card = body.closest<HTMLElement>(".module-card")!;

    await runModule(mod, body, ctx, {
      onLoading: () => {
        setCardStatus(card, "loading");
        body!.innerHTML = `<p class="placeholder">Chargement…</p>`;
      },
      onError: (message) => {
        body!.innerHTML = `<p class="error">Erreur : ${message}</p>`;
      },
    });
    // Un module peut afficher lui-même une donnée indisponible sans lever
    // d'erreur : on le signale dans l'en-tête, visible même replié.
    setCardStatus(card, body.querySelector(".error") ? "warning" : "ok");
  }
}

// --- Cartes de module dépliables ---------------------------------------------
type CardStatus = "loading" | "ok" | "warning";
const STATUS_TEXT: Record<CardStatus, string> = {
  loading: "Chargement…",
  ok: "",
  warning: "Données manquantes",
};

/** Crée une carte de module repliée ; renvoie son corps (où le module s'affiche). */
function createModuleCard(id: string, title: string): HTMLElement {
  const card = document.createElement("section");
  card.className = "module-card collapsed";
  const bodyId = `module-body-${id}`;
  card.innerHTML = `
    <h2 class="module-heading">
      <button type="button" class="module-toggle" aria-expanded="false" aria-controls="${bodyId}">
        <span class="module-title"></span>
        <span class="module-status" aria-live="polite"></span>
        <span class="module-chevron" aria-hidden="true"></span>
      </button>
    </h2>
    <div class="module-body" id="${bodyId}" hidden></div>`;
  card.querySelector(".module-title")!.textContent = title;
  card.querySelector(".module-toggle")!.addEventListener("click", () => {
    setCardOpen(card, card.classList.contains("collapsed"));
  });
  // La barre vit dans la colonne des modules (vidée à chaque recherche).
  if (!modulesToolbar.isConnected) modulesEl.prepend(modulesToolbar);
  modulesEl.appendChild(card);
  modulesToolbar.hidden = false;
  return card.querySelector<HTMLElement>(".module-body")!;
}

function setCardOpen(card: HTMLElement, open: boolean): void {
  card.classList.toggle("collapsed", !open);
  card.querySelector(".module-toggle")!.setAttribute("aria-expanded", String(open));
  card.querySelector<HTMLElement>(".module-body")!.hidden = !open;
}

function setCardStatus(card: HTMLElement, status: CardStatus): void {
  card.dataset.status = status;
  card.querySelector(".module-status")!.textContent = STATUS_TEXT[status];
}

// --- Tout déplier / tout replier ---------------------------------------------
const modulesToolbar = document.createElement("div");
modulesToolbar.className = "modules-toolbar";
modulesToolbar.hidden = true;
modulesToolbar.innerHTML = `
  <button type="button" data-open="true">Tout déplier</button>
  <button type="button" data-open="false">Tout replier</button>`;
modulesToolbar.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-open]");
  if (!btn) return;
  const open = btn.dataset.open === "true";
  modulesEl.querySelectorAll<HTMLElement>(".module-card").forEach((c) => setCardOpen(c, open));
});

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
