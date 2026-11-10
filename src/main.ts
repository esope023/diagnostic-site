// Point d'entrée : câble la recherche, le rayon d'analyse, la carte,
// l'exécution des modules et l'export. Pour ajouter un module : l'importer,
// l'enregistrer ci-dessous, et déclarer sa portée ("site" ou "quartier").
import "leaflet/dist/leaflet.css";
import "./styles.css";

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
/** Au-delà, le module affiche « délai dépassé » ; s'il aboutit plus tard, son
 * résultat remplace le message. Aucun module ne bloque plus les autres. */
const MODULE_TIMEOUT_MS = 180_000;
/** Identifiant de la dernière analyse lancée : une analyse dépassée n'écrit plus. */
let runId = 0;

type AnyMod = ReturnType<typeof getModules>[number];

async function runModules(
  ctx: SiteContext,
  filter: (m: AnyMod) => boolean = () => true,
): Promise<void> {
  const id = ++runId;
  const runs = getModules()
    .filter(filter)
    .map((mod) => runOneModule(mod, ctx, id));
  await Promise.all(runs);
}

/** Lance un module dans sa carte, en parallèle des autres, avec délai maximal. */
async function runOneModule(mod: AnyMod, ctx: SiteContext, id: number): Promise<void> {
  let body = moduleBodies.get(mod.id);
  if (!body) {
    body = createModuleCard(mod.id, `${mod.icon ?? ""} ${mod.label}`);
    moduleBodies.set(mod.id, body);
  }
  const card = body.closest<HTMLElement>(".module-card")!;

  // Chaque exécution rend dans un emplacement neuf : si une analyse plus
  // récente le remplace, le rendu tardif de l'ancienne tombe hors de la page.
  const slot = document.createElement("div");
  body.replaceChildren(slot);
  const isCurrent = () => id === runId && slot.isConnected;

  let timedOut = false;
  setCardStatus(card, "loading");
  const done = runModule(mod, slot, ctx, {
    onLoading: () => {
      slot.innerHTML = `<p class="placeholder">Chargement…</p>`;
    },
    onError: (message) => {
      slot.innerHTML = `<p class="error">Erreur : ${message}</p>`;
    },
  }).then(() => {
    if (!isCurrent()) return;
    setCardStatus(card, slot.querySelector(".error") ? "warning" : "ok");
    // Un module arrivé après le délai met la synthèse à jour.
    if (timedOut) refreshSynthese();
  });

  const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), MODULE_TIMEOUT_MS));
  const outcome = await Promise.race([done.then(() => "done" as const), timeout]);
  if (outcome === "timeout" && isCurrent()) {
    timedOut = true;
    slot.innerHTML = `
      <p class="error">Délai dépassé : une source n'a pas répondu en
      ${MODULE_TIMEOUT_MS / 60_000} minutes. Ce n'est pas une absence de donnée.
      Le résultat s'affichera ici s'il finit par arriver.</p>`;
    setCardStatus(card, "warning");
  }
  if (isCurrent() && card.dataset.status === "warning") addRetryButton(slot, mod, ctx);
}

function addRetryButton(slot: HTMLElement, mod: AnyMod, ctx: SiteContext): void {
  if (slot.querySelector(".module-retry")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "module-retry";
  btn.textContent = "Réessayer ce module";
  btn.addEventListener("click", async () => {
    await runOneModule(mod, ctx, runId);
    refreshSynthese();
  });
  slot.appendChild(btn);
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
