// Atelier cartographique : carte pleine page (MapLibre, 2D et 3D) et menu des
// couches à gauche, chacune avec son interrupteur et sa réglette d'opacité.
// Chargé à la demande (import dynamique) : MapLibre pèse ~1 Mo.
//
// Reprend la vue 3D du Diagnostic (bâtiments BD TOPO, ombres portées à date
// et heure légale) et ajoute les couches de contexte (cadastre, urbanisme,
// risques, nature, végétation).

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchJson } from "../api/client";
import { fetchBuildingsWithHeight, BUILDING_SOURCE_LABEL, type BuildingsResult } from "../core/buildings";
import { bboxAroundMeters } from "../core/geo";
import type { SiteContext } from "../core/types";
import { fetchTrees } from "../modules/soleil/fetch";
import { DEFAULT_HEIGHT_M, MAX_SHADOW_M, type ShadowBuilding } from "../map3d/shadows";
import type { ShadowRequest, ShadowResponse } from "../map3d/shadow-worker";
import { sunAtLegalTime, formatHour } from "../map3d/sun";
import {
  COUCHES, FAMILLES, FONDS, HAUTEURS, INCONNU, USAGES, USAGE_AUTRE, NEUTRE, COSIA, PAS_CARROYAGE, tuilesCosia,
  type CoucheDef, type Fond, type MillesimeCosia,
} from "./couches";
import { carroyage } from "./lambert93";
import { creerCoucheArbres3D } from "./arbres3d";
import { ombresArbres } from "./ombres-arbres";
import { brancherMiseEnPage, type ElementLegende } from "./mise-en-page";

type Coloration = "neutre" | "hauteur" | "usage";

export interface Atelier {
  setSite(ctx: SiteContext): Promise<void>;
  /** À appeler quand l'onglet redevient visible. */
  resize(): void;
}

interface Etat {
  actif: boolean;
  opacite: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function cercle(lat: number, lon: number, r: number, n = 96): [number, number][] {
  const mLat = 110_540;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [lon + (Math.sin(a) * r) / mLon, lat + (Math.cos(a) * r) / mLat] as [number, number];
  });
}

function repere(): HTMLElement {
  const el = document.createElement("div");
  el.className = "site-marker";
  el.innerHTML = `<svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
    <line x1="18" y1="1" x2="18" y2="11" /><line x1="18" y1="25" x2="18" y2="35" />
    <line x1="1" y1="18" x2="11" y2="18" /><line x1="25" y1="18" x2="35" y2="18" />
    <circle cx="18" cy="18" r="7" class="ring" /><circle cx="18" cy="18" r="3" class="dot" /></svg>`;
  return el;
}

function batiGeoJSON(data: BuildingsResult): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: data.buildings.map((b, i) => ({
      type: "Feature",
      id: i,
      geometry: {
        type: "Polygon",
        coordinates: [[...b.polygon.map((p) => [p.lon, p.lat]), [b.polygon[0].lon, b.polygon[0].lat]]],
      },
      properties: {
        h: b.heightM ?? DEFAULT_HEIGHT_M,
        connue: b.heightM !== null,
        usage: b.info?.usage ?? "",
        etages: b.info?.etages ?? null,
        logements: b.info?.logements ?? null,
      },
    })),
  };
}

/** Zones de végétation BD TOPO (WFS Géoplateforme), dans l'emprise. */
async function fetchVegetation(ctx: SiteContext, r: number): Promise<GeoJSON.FeatureCollection> {
  const b = bboxAroundMeters(ctx.lat, ctx.lon, r);
  const url =
    `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=BDTOPO_V3:zone_de_vegetation&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=3000` +
    `&BBOX=${b.minLon},${b.minLat},${b.maxLon},${b.maxLat},EPSG:4326`;
  return fetchJson<GeoJSON.FeatureCollection>(url, {
    cacheKey: "bdtopo:vegetation",
    ttlMs: 30 * 24 * 60 * 60 * 1000,
    timeoutMs: 30_000,
    retries: 2,
  });
}

/** WebGL disponible ? (désactivé si le navigateur a coupé l'accélération graphique). */
function webglDisponible(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function createAtelier(root: HTMLElement): Atelier {
  if (!webglDisponible()) {
    root.innerHTML = `<div class="at-sans-webgl"><div>
      <h2>La carte de l'atelier ne peut pas s'afficher</h2>
      <p>Le navigateur a désactivé l'accélération graphique (WebGL), nécessaire à la carte 2D et 3D.
      Cela arrive souvent après un plantage du moteur graphique du navigateur.</p>
      <ol>
        <li>Quittez complètement le navigateur, puis relancez-le.</li>
        <li>Si le problème persiste, dans Chrome : Réglages › Système › activez « Utiliser l'accélération graphique si disponible ».</li>
        <li>Contrôle : la page <code>chrome://gpu</code> doit indiquer « WebGL : Hardware accelerated ».</li>
      </ol>
      <p>L'onglet <a href="#diagnostic">Diagnostic</a> reste utilisable.</p>
    </div></div>`;
    return { setSite: async () => {}, resize: () => {} };
  }
  const etat = new Map<string, Etat>(COUCHES.map((c) => [c.id, { actif: c.active, opacite: c.opacite }]));
  let fond: Fond = "plan";
  let coloration: Coloration = "hauteur";
  let mode3d = false;
  let rendu: "volume" | "point" = "volume";
  let derniersArbres: { arbres: import("../modules/soleil/fetch").ArbreOsm[]; lat0: number; lon0: number } | null = null;
  let millesime: MillesimeCosia = "2021-2023";
  let pas: (typeof PAS_CARROYAGE)[number] = 100;

  // --- Gabarit ----------------------------------------------------------------
  const ligne = (c: CoucheDef) => {
    const e = etat.get(c.id)!;
    const extra =
      c.id === "fond"
        ? `<div class="segmented seg-sm" role="group" aria-label="Fond de carte">
            ${(Object.keys(FONDS) as Fond[]).map((k) => `<button type="button" data-fond="${k}" aria-pressed="${k === fond}">${FONDS[k].titre}</button>`).join("")}
          </div>`
        : c.id === "cosia"
          ? `<div class="segmented seg-sm" role="group" aria-label="Millésime CoSIA">
              ${(Object.keys(COSIA) as MillesimeCosia[]).map((m) => `<button type="button" data-cosia="${m}" aria-pressed="${m === millesime}">${m}</button>`).join("")}
            </div>`
        : c.id === "arbres"
          ? `<div class="segmented seg-sm" role="group" aria-label="Rendu des arbres">
              <button type="button" data-rendu="volume" aria-pressed="true">Volume</button>
              <button type="button" data-rendu="point" aria-pressed="false">Point</button>
            </div>`
        : c.id === "carroyage"
          ? `<div class="segmented seg-sm" role="group" aria-label="Pas du carroyage">
              ${PAS_CARROYAGE.map((v) => `<button type="button" data-pas="${v}" aria-pressed="${v === pas}">${v} m</button>`).join("")}
            </div>`
        : c.id === "bati"
          ? `<div class="segmented seg-sm" role="group" aria-label="Coloration des bâtiments">
              <button type="button" data-colo="neutre" aria-pressed="false">Neutre</button>
              <button type="button" data-colo="hauteur" aria-pressed="true">Hauteur</button>
              <button type="button" data-colo="usage" aria-pressed="false">Usage</button>
              <button type="button" disabled title="L'année de construction n'est pas publiée dans la BD TOPO">Époque</button>
            </div>
            <div class="at-legende" data-legende-bati></div>
            <p class="at-note" data-bati-source></p>`
          : "";
    return `<div class="at-couche${e.actif ? " on" : ""}" data-couche="${c.id}">
      <label class="at-ligne">
        <span class="at-titre">${esc(c.titre)}<span class="at-source">${esc(c.source)}</span></span>
        <input type="checkbox" class="switch" ${e.actif ? "checked" : ""} aria-label="Afficher ${esc(c.titre)}">
      </label>
      <div class="at-reglages">
        ${extra}
        ${c.note ? `<p class="at-note">${esc(c.note)}</p>` : ""}
        ${c.legende ? `<details class="at-leg"><summary>Légende</summary><div class="at-leg-box"><img class="at-legende-img" alt="Légende : ${esc(c.titre)}" loading="lazy" src="${c.legende}" onerror="this.closest('details').remove()"></div></details>` : ""}
        <label class="at-opacite"><span>Opacité</span>
          <input type="range" min="0" max="100" step="5" value="${Math.round(e.opacite * 100)}" aria-label="Opacité de ${esc(c.titre)}">
          <output>${Math.round(e.opacite * 100)} %</output></label>
        <p class="at-etat" hidden></p>
      </div>
    </div>`;
  };

  root.innerHTML = `
    <aside class="at-panneau" aria-label="Couches">
      <div class="at-entete"><h2>Couches</h2><span class="at-compte"></span>
        <button type="button" class="icon-btn at-replier" aria-label="Replier le panneau" title="Replier le panneau">‹</button></div>
      <div class="at-site"></div>
      <div class="at-familles">
        ${FAMILLES.map((f) => `<section class="at-famille"><h3>${f}</h3>${COUCHES.filter((c) => c.famille === f).map(ligne).join("")}</section>`).join("")}
      </div>
      <p class="at-sources">Sources : IGN (Plan, BD ORTHO®, BD TOPO®, Parcellaire Express), Géoportail de
        l'Urbanisme, Géorisques, INPN, OpenStreetMap.</p>
    </aside>
    <div class="at-carte">
      <div class="at-canvas"></div>
      <button type="button" class="at-ouvrir icon-btn" aria-label="Afficher les couches" title="Afficher les couches">☰</button>
      <div class="segmented at-mode" role="group" aria-label="Vue">
        <button type="button" data-mode="2d" aria-pressed="true">2D</button>
        <button type="button" data-mode="3d" aria-pressed="false">3D</button>
      </div>
      <div class="m3d-panel m3d-sun at-soleil" hidden>
        <div class="m3d-sun-row">
          <input type="date" class="m3d-date" aria-label="Date">
          <span class="m3d-presets">
            <button type="button" data-md="12-21">21 déc.</button>
            <button type="button" data-md="03-20">21 mars</button>
            <button type="button" data-md="06-21">21 juin</button>
          </span>
        </div>
        <input type="range" class="m3d-hour" min="5" max="22" step="0.25" value="14" aria-label="Heure légale">
        <p class="m3d-sun-info" aria-live="polite"></p>
      </div>
      <div class="at-vide" hidden>
        <p>Lancez d'abord une analyse dans l'onglet <a href="#diagnostic">Diagnostic</a> :
        l'atelier reprend son site et son périmètre.</p>
      </div>
    </div>`;

  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const canvasEl = q<HTMLElement>(".at-canvas");
  const dateInput = q<HTMLInputElement>(".m3d-date");
  const hourInput = q<HTMLInputElement>(".m3d-hour");
  const sunInfo = q<HTMLElement>(".m3d-sun-info");
  const soleilPanel = q<HTMLElement>(".at-soleil");
  const vide = q<HTMLElement>(".at-vide");
  dateInput.value = today();

  // Panneau repliable (fermé par défaut sur téléphone).
  const setPanneau = (ouvert: boolean) => root.classList.toggle("panneau-ferme", !ouvert);
  setPanneau(!window.matchMedia("(max-width: 800px)").matches);
  q<HTMLButtonElement>(".at-replier").addEventListener("click", () => {
    setPanneau(false);
    setTimeout(() => map.resize(), 220);
  });
  q<HTMLButtonElement>(".at-ouvrir").addEventListener("click", () => {
    setPanneau(true);
    setTimeout(() => map.resize(), 220);
  });

  // --- Carte -------------------------------------------------------------------
  const vecteur = (): maplibregl.GeoJSONSourceSpecification => ({ type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const raster = (c: CoucheDef): maplibregl.LayerSpecification => ({
    id: c.id,
    type: "raster",
    source: c.id,
    layout: { visibility: etat.get(c.id)!.actif ? "visible" : "none" },
    paint: { "raster-opacity": etat.get(c.id)!.opacite, "raster-fade-duration": 150 },
  });
  const rasters = COUCHES.filter((c) => c.tuiles);

  const map = new maplibregl.Map({
    container: canvasEl,
    style: {
      version: 8,
      sources: {
        plan: { type: "raster", tiles: [FONDS.plan.tuiles], tileSize: 256, maxzoom: 19, attribution: "© IGN" },
        photo: { type: "raster", tiles: [FONDS.photo.tuiles], tileSize: 256, maxzoom: 19, attribution: "© IGN" },
        ...Object.fromEntries(
          rasters.map((c) => [c.id, { type: "raster", tiles: [c.tuiles!], tileSize: 256, maxzoom: c.zoomMax ?? 20, attribution: c.source }]),
        ),
        bati: vecteur(),
        vegetation: vecteur(),
        arbres: vecteur(),
        ombres: vecteur(),
        "ombres-arbres": vecteur(),
        perimetre: vecteur(),
        carroyage: vecteur(),
      },
      layers: [
        { id: "fond-uni", type: "background", paint: { "background-color": "#efeeea" } },
        { id: "fond-plan", type: "raster", source: "plan", paint: { "raster-opacity": 0.7 } },
        { id: "fond-photo", type: "raster", source: "photo", layout: { visibility: "none" }, paint: { "raster-opacity": 0.7 } },
        ...rasters.filter((c) => c.id !== "cadastre").map(raster),
        { id: "vegetation", type: "fill", source: "vegetation", layout: { visibility: "none" }, paint: { "fill-color": "#5f9e4b", "fill-opacity": 0.5 } },
        { id: "ombres", type: "fill", source: "ombres", layout: { visibility: "none" }, paint: { "fill-color": "#1f2a44", "fill-opacity": 0.4 } },
        { id: "ombres-arbres", type: "fill", source: "ombres-arbres", layout: { visibility: "none" }, paint: { "fill-color": "#1f2a44", "fill-opacity": 0.32 } },
        raster(COUCHES.find((c) => c.id === "cadastre")!),
        { id: "bati-2d", type: "fill", source: "bati", paint: { "fill-color": NEUTRE, "fill-opacity": 1, "fill-outline-color": "rgba(60,60,60,0.45)" } },
        {
          id: "bati-3d",
          type: "fill-extrusion",
          source: "bati",
          layout: { visibility: "none" },
          paint: { "fill-extrusion-color": NEUTRE, "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 1, "fill-extrusion-vertical-gradient": false },
        },
        {
          id: "arbres",
          type: "circle",
          source: "arbres",
          paint: {
            "circle-color": "#3f8f3a",
            "circle-opacity": 0.85,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 1.5, 17, 4, 19, 9],
          },
        },
        {
          id: "carroyage",
          type: "line",
          source: "carroyage",
          layout: { visibility: "none" },
          paint: { "line-color": "#3a3a3c", "line-opacity": 0.45, "line-width": ["case", ["get", "majeur"], 1, 0.5] },
        },
        { id: "perimetre", type: "line", source: "perimetre", paint: { "line-color": "#3a3a3c", "line-width": 1.5, "line-dasharray": [3, 2] } },
      ],
    },
    center: [2.5, 46.6],
    zoom: 5,
    maxPitch: 75,
    attributionControl: { compact: true },
    canvasContextAttributes: { preserveDrawingBuffer: true }, // exports à venir (mise en page)
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 140 }), "bottom-right");
  // Arbres en volume (three.js), sous le carroyage et le périmètre.
  const coucheArbres = creerCoucheArbres3D("arbres-3d");
  const pret = new Promise<void>((r) =>
    map.once("load", () => {
      map.addLayer(coucheArbres, "carroyage");
      map.setLayoutProperty("arbres-3d", "visibility", "none");
      r();
    }),
  );

  // --- Application de l'état aux couches ---------------------------------------
  const PROP: Record<string, string> = { raster: "raster-opacity", fill: "fill-opacity", circle: "circle-opacity", line: "line-opacity", "fill-extrusion": "fill-extrusion-opacity" };
  function couchesMap(id: string): string[] {
    if (id === "fond") return [];
    if (id === "bati") return ["bati-2d", "bati-3d"];
    if (id === "arbres") return ["arbres", "arbres-3d"];
    if (id === "repere") return [];
    return [id];
  }
  function appliquer(id: string): void {
    const e = etat.get(id)!;
    if (id === "fond") {
      map.setLayoutProperty("fond-plan", "visibility", e.actif && fond === "plan" ? "visible" : "none");
      map.setLayoutProperty("fond-photo", "visibility", e.actif && fond === "photo" ? "visible" : "none");
      map.setPaintProperty("fond-plan", "raster-opacity", e.opacite);
      map.setPaintProperty("fond-photo", "raster-opacity", e.opacite);
    }
    for (const lid of couchesMap(id)) {
      const layer = map.getLayer(lid);
      if (!layer) continue;
      let visible = e.actif;
      if (lid === "bati-2d") visible = e.actif && !mode3d;
      if (lid === "bati-3d") visible = e.actif && mode3d;
      // Arbres en volume dans les deux vues (vus en plan en 2D), ou en points.
      if (lid === "arbres") visible = e.actif && rendu === "point";
      if (lid === "arbres-3d") visible = e.actif && rendu === "volume";
      map.setLayoutProperty(lid, "visibility", visible ? "visible" : "none");
      const prop = PROP[layer.type];
      if (prop) map.setPaintProperty(lid, prop, e.opacite);
      if (lid === "arbres-3d") coucheArbres.setOpacite(e.opacite);
      if (lid === "arbres") map.setPaintProperty(lid, "circle-stroke-opacity", e.opacite);
    }
    if (id === "repere" && marker) {
      const el = marker.getElement();
      el.style.display = e.actif ? "" : "none";
      el.style.opacity = String(e.opacite);
    }
    if (id === "carroyage" && e.actif) dessinerCarroyage();
    if (id === "ombres" || id === "arbres") {
      const o = etat.get("ombres")!;
      if (map.getLayer("ombres-arbres")) {
        map.setLayoutProperty("ombres-arbres", "visibility", o.actif && etat.get("arbres")!.actif ? "visible" : "none");
        map.setPaintProperty("ombres-arbres", "fill-opacity", o.opacite * 0.8);
      }
    }
    if (id === "ombres" && !e.actif) eclairer(null);
    if (id === "ombres") {
      soleilPanel.hidden = !e.actif;
      if (e.actif) demanderOmbres();
    }
  }
  function compter(): void {
    const n = [...etat.values()].filter((e) => e.actif).length;
    q<HTMLElement>(".at-compte").textContent = `${n} active${n > 1 ? "s" : ""}`;
  }

  // --- Coloration du bâti ----------------------------------------------------------
  function couleurBati(): maplibregl.DataDrivenPropertyValueSpecification<string> {
    if (coloration === "neutre") return NEUTRE;
    if (coloration === "usage") {
      return ["match", ["get", "usage"], ...USAGES.flatMap((u) => [u.valeur, u.color]), USAGE_AUTRE] as unknown as maplibregl.ExpressionSpecification;
    }
    return [
      "case",
      ["!", ["get", "connue"]],
      INCONNU,
      ["step", ["get", "h"], HAUTEURS[0].color, ...HAUTEURS.slice(0, -1).flatMap((c, i) => [c.max, HAUTEURS[i + 1].color])],
    ] as maplibregl.ExpressionSpecification;
  }
  function legendeBati(): string {
    const pastille = (color: string, label: string) => `<span><i style="background:${color}"></i>${esc(label)}</span>`;
    if (coloration === "neutre") return "";
    if (coloration === "usage") return USAGES.map((u) => pastille(u.color, u.valeur)).join("") + pastille(USAGE_AUTRE, "Annexe, autre ou inconnu");
    return HAUTEURS.map((h) => pastille(h.color, `${h.label} m`)).join("") + pastille(INCONNU, `inconnue (${DEFAULT_HEIGHT_M} m supposés)`);
  }
  function appliquerColoration(): void {
    if (etat.get("ombres")!.actif && dernierSoleil) eclairer(dernierSoleil);
    map.setPaintProperty("bati-2d", "fill-color", couleurBati());
    map.setPaintProperty("bati-3d", "fill-extrusion-color", couleurBati());
    q<HTMLElement>("[data-legende-bati]").innerHTML = legendeBati();
    root.querySelectorAll<HTMLButtonElement>("[data-cosia]").forEach((b) =>
    b.addEventListener("click", async () => {
      millesime = b.dataset.cosia as MillesimeCosia;
      root.querySelectorAll("[data-cosia]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      await pret;
      (map.getSource("cosia") as maplibregl.RasterTileSource).setTiles([tuilesCosia(millesime)]);
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-rendu]").forEach((b) =>
    b.addEventListener("click", async () => {
      rendu = b.dataset.rendu as typeof rendu;
      root.querySelectorAll("[data-rendu]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      await pret;
      appliquer("arbres");
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-pas]").forEach((b) =>
    b.addEventListener("click", async () => {
      pas = Number(b.dataset.pas) as typeof pas;
      root.querySelectorAll("[data-pas]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      await pret;
      dessinerCarroyage();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-colo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.colo === coloration)));
  }

  // --- Interactions du panneau ---------------------------------------------------
  root.querySelectorAll<HTMLElement>(".at-couche").forEach((el) => {
    const id = el.dataset.couche!;
    const e = etat.get(id)!;
    const sw = el.querySelector<HTMLInputElement>(".switch")!;
    const range = el.querySelector<HTMLInputElement>('input[type="range"]')!;
    const out = el.querySelector("output")!;
    sw.addEventListener("change", async () => {
      e.actif = sw.checked;
      el.classList.toggle("on", e.actif);
      compter();
      await pret;
      appliquer(id);
      if (e.actif) void chargerCouche(id);
    });
    range.addEventListener("input", async () => {
      e.opacite = Number(range.value) / 100;
      out.textContent = `${range.value} %`;
      await pret;
      appliquer(id);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-fond]").forEach((b) =>
    b.addEventListener("click", async () => {
      fond = b.dataset.fond as Fond;
      root.querySelectorAll("[data-fond]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      await pret;
      appliquer("fond");
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-colo]").forEach((b) =>
    b.addEventListener("click", async () => {
      coloration = b.dataset.colo as Coloration;
      await pret;
      appliquerColoration();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>(".at-mode button").forEach((b) =>
    b.addEventListener("click", () => {
      mode3d = b.dataset.mode === "3d";
      root.querySelectorAll(".at-mode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      map.easeTo({ pitch: mode3d ? 55 : 0, bearing: mode3d ? -20 : 0, duration: 600 });
      appliquer("bati");
      appliquer("arbres");
    }),
  );

  // --- Carroyage Lambert-93 ----------------------------------------------------------
  function dessinerCarroyage(): void {
    if (!site) return;
    const demi = Math.max(600, (site.radiusM ?? 150) * 3);
    (map.getSource("carroyage") as maplibregl.GeoJSONSource).setData(carroyage(site.lat, site.lon, demi, pas));
  }

  // --- Ombres (worker) ------------------------------------------------------------
  const worker = new Worker(new URL("../map3d/shadow-worker.ts", import.meta.url), { type: "module" });
  let site: SiteContext | null = null;
  let demande = 0;
  let enCours = false;
  let enAttente = false;
  let batimentsEnvoyes = false;

  function soleil() {
    if (!site) return null;
    const h = Number(hourInput.value);
    const sun = sunAtLegalTime(site.lat, site.lon, dateInput.value || today(), h);
    const tz = sun.utcOffset === 2 ? "heure d'été" : "heure d'hiver";
    const nuit = sun.elevationDeg <= 0.5;
    const l10 = nuit ? 0 : Math.min(10 / Math.tan((sun.elevationDeg * Math.PI) / 180), MAX_SHADOW_M);
    sunInfo.innerHTML = nuit
      ? `<strong>${formatHour(h)}</strong> (${tz}) — soleil sous l'horizon`
      : `<strong>${formatHour(h)}</strong> (${tz}) · soleil à ${sun.elevationDeg.toFixed(0)}° de hauteur,
         azimut ${sun.azimuthDeg.toFixed(0)}° · un bâtiment de 10 m porte ${l10.toFixed(0)} m d'ombre`;
    return sun;
  }
  /**
   * Lumière de la carte calée sur le soleil (ombres actives) : les façades
   * éclairées suivent l'heure et la saison, lumière chaude et rasante au lever,
   * au coucher et en hiver, sombre la nuit. null : éclairage neutre par défaut.
   */
  /**
   * Lumière de la carte calée sur le soleil (ombres actives) : la direction
   * suit toujours le soleil (faces éclairées / à l'ombre). La teinte chaude du
   * soleil bas ne s'applique qu'en coloration « Neutre » : avec Hauteur ou
   * Usage, la lumière reste blanche pour ne pas fausser les couleurs de la
   * légende. Réglages choisis à l'œil dans le Chrome de Cédric le 13/11.
   */
  let dernierSoleil: { azimuthDeg: number; elevationDeg: number } | null = null;
  function eclairer(sun: { azimuthDeg: number; elevationDeg: number } | null): void {
    dernierSoleil = sun;
    if (!sun) {
      map.setLight({ anchor: "viewport", position: [1.15, 210, 30], color: "#ffffff", intensity: 0.5 });
      coucheArbres.setSoleil(null);
      return;
    }
    const neutre = coloration === "neutre";
    const el = sun.elevationDeg;
    if (el <= 0.5) {
      map.setLight({ anchor: "map", position: [1.5, sun.azimuthDeg, 80], color: neutre ? "#8a93b8" : "#ffffff", intensity: neutre ? 0.45 : 0.3 });
      coucheArbres.setSoleil({ azimut: sun.azimuthDeg, hauteur: 0, couleur: 0x8a93b8, intensite: 0 });
      return;
    }
    const t = Math.min(1, el / 45); // 0 : soleil rasant, 1 : soleil haut
    // Teinte douce : orangé clair au soleil rasant, presque blanc au soleil haut.
    const g = Math.round(214 + 30 * t);
    const b = Math.round(170 + 68 * t);
    const hex = (255 << 16) | (g << 8) | b;
    map.setLight({
      anchor: "map",
      position: [1.5, sun.azimuthDeg, Math.max(5, 90 - el)],
      color: neutre ? `#${hex.toString(16).padStart(6, "0")}` : "#ffffff",
      intensity: neutre ? 0.72 + 0.13 * t : 0.6,
    });
    coucheArbres.setSoleil({ azimut: sun.azimuthDeg, hauteur: el, couleur: hex, intensite: t });
  }

  function demanderOmbres(): void {
    const actif = etat.get("ombres")!.actif;
    const s0 = soleil();
    if (actif && s0) {
      eclairer(s0);
      (map.getSource("ombres-arbres") as maplibregl.GeoJSONSource | undefined)?.setData(
        ombresArbres(derniersArbres?.arbres ?? [], s0.azimuthDeg, s0.elevationDeg),
      );
    }
    if (!actif || !batimentsEnvoyes) return;
    const sun = s0;
    if (!sun) return;
    if (enCours) {
      enAttente = true;
      return;
    }
    enCours = true;
    worker.postMessage({ kind: "compute", id: ++demande, elevationDeg: sun.elevationDeg, azimuthDeg: sun.azimuthDeg } satisfies ShadowRequest);
  }
  worker.onmessage = (e: MessageEvent<ShadowResponse>) => {
    enCours = false;
    if (e.data.id === demande) {
      (map.getSource("ombres") as maplibregl.GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: e.data.result.multiPolygon },
      });
    }
    if (enAttente) {
      enAttente = false;
      demanderOmbres();
    }
  };
  hourInput.addEventListener("input", demanderOmbres);
  dateInput.addEventListener("change", demanderOmbres);
  root.querySelectorAll<HTMLButtonElement>(".m3d-presets button").forEach((b) =>
    b.addEventListener("click", () => {
      dateInput.value = `${(dateInput.value || today()).slice(0, 4)}-${b.dataset.md}`;
      demanderOmbres();
    }),
  );

  // --- Données dépendant du site ---------------------------------------------------
  const charge = new Set<string>();
  function etatCouche(id: string, texte: string): void {
    const p = root.querySelector<HTMLElement>(`[data-couche="${id}"] .at-etat`);
    if (!p) return;
    p.hidden = !texte;
    p.textContent = texte;
  }

  async function chargerCouche(id: string): Promise<void> {
    if (!site || charge.has(id)) return;
    const ctx = site;
    const r = ctx.radiusM ?? 150;
    charge.add(id);
    try {
      if (id === "bati") {
        etatCouche(id, "Chargement…");
        const data = await fetchBuildingsWithHeight(ctx, r);
        if (site !== ctx) return;
        (map.getSource("bati") as maplibregl.GeoJSONSource).setData(batiGeoJSON(data));
        const connues = data.buildings.filter((b) => b.heightM !== null).length;
        q<HTMLElement>("[data-bati-source]").textContent =
          data.source === "indisponible"
            ? "Bâtiments indisponibles (BD TOPO et OpenStreetMap n'ont pas répondu)."
            : `${data.buildings.length} bâtiments · ${BUILDING_SOURCE_LABEL[data.source]} · hauteur connue pour ${
                data.buildings.length ? Math.round((connues / data.buildings.length) * 100) : 0
              } %`;
        etatCouche(id, "");
        if (data.source === "indisponible") charge.delete(id);
        const sb: ShadowBuilding[] = data.buildings.map((b) => ({ ring: b.polygon.map((p) => [p.lon, p.lat] as [number, number]), heightM: b.heightM }));
        worker.postMessage({ kind: "buildings", buildings: sb, lat0: ctx.lat, lon0: ctx.lon } satisfies ShadowRequest);
        batimentsEnvoyes = true;
        demanderOmbres();
      } else if (id === "ombres") {
        await chargerCouche("bati");
        demanderOmbres();
      } else if (id === "arbres") {
        etatCouche(id, "Chargement…");
        const arbres = await fetchTrees(ctx, r);
        if (site !== ctx) return;
        (map.getSource("arbres") as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: arbres.map((a) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [a.lon, a.lat] } })),
        });
        coucheArbres.setArbres(arbres, ctx.lat, ctx.lon);
        derniersArbres = { arbres, lat0: ctx.lat, lon0: ctx.lon };
        demanderOmbres();
        etatCouche(id, arbres.length ? `${arbres.length} arbres recensés dans le périmètre.` : "Aucun arbre recensé dans OpenStreetMap ici (inventaire souvent incomplet).");
      } else if (id === "vegetation") {
        etatCouche(id, "Chargement…");
        const fc = await fetchVegetation(ctx, r);
        if (site !== ctx) return;
        (map.getSource("vegetation") as maplibregl.GeoJSONSource).setData(fc);
        etatCouche(id, fc.features?.length ? "" : "Aucune zone de végétation BD TOPO dans le périmètre.");
      }
    } catch {
      charge.delete(id);
      etatCouche(id, "Source indisponible pour le moment — ce n'est pas une absence de donnée.");
    }
  }

  // --- Fiche d'un bâtiment ----------------------------------------------------------
  for (const lid of ["bati-2d", "bati-3d"]) {
    map.on("click", lid, (e) => {
      const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
      if (!p) return;
      const lignes = [
        `<strong>Hauteur :</strong> ${p.connue ? `${Number(p.h).toFixed(1)} m` : `inconnue (${DEFAULT_HEIGHT_M} m supposés)`}`,
        p.usage ? `<strong>Usage :</strong> ${esc(String(p.usage))}` : "",
        p.etages ? `<strong>Étages :</strong> ${p.etages}` : "",
        p.logements ? `<strong>Logements :</strong> ${p.logements}` : "",
      ].filter(Boolean);
      new maplibregl.Popup({ maxWidth: "240px" }).setLngLat(e.lngLat).setHTML(`<div class="m3d-popup">${lignes.join("<br>")}</div>`).addTo(map);
    });
    map.on("mouseenter", lid, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", lid, () => (map.getCanvas().style.cursor = ""));
  }

  // --- Site ----------------------------------------------------------------------------
  let marker: maplibregl.Marker | null = null;
  async function setSite(ctx: SiteContext): Promise<void> {
    await pret;
    const memePoint = site && site.lat === ctx.lat && site.lon === ctx.lon;
    site = ctx;
    vide.hidden = true;
    q<HTMLElement>(".at-site").textContent = `${ctx.label}${ctx.radiusM !== null ? ` · périmètre ${ctx.radiusM} m` : " · échelle parcelle"}`;
    (map.getSource("perimetre") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: ctx.radiusM !== null ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: cercle(ctx.lat, ctx.lon, ctx.radiusM) } }] : [],
    });
    marker?.remove();
    marker = new maplibregl.Marker({ element: repere() }).setLngLat([ctx.lon, ctx.lat]).addTo(map);
    appliquer("repere");
    if (etat.get("carroyage")!.actif) dessinerCarroyage();
    if (!memePoint) {
      const r = ctx.radiusM ?? 150;
      map.jumpTo({ center: [ctx.lon, ctx.lat], zoom: r > 450 ? 15.3 : r > 200 ? 16.2 : 17, pitch: mode3d ? 55 : 0, bearing: mode3d ? -20 : 0 });
    }
    // Les données vectorielles dépendent du point et du rayon : on recharge.
    charge.clear();
    batimentsEnvoyes = false;
    for (const id of ["bati", "arbres", "vegetation", "ombres"]) if (etat.get(id)!.actif) void chargerCouche(id);
  }

  void pret.then(() => {
    COUCHES.forEach((c) => appliquer(c.id));
    appliquerColoration();
    compter();
    if (!site) vide.hidden = false;
  });

  // --- Mise en page et export ------------------------------------------------------
  brancherMiseEnPage({
    map,
    carte: q<HTMLElement>(".at-carte"),
    site: () => site,
    arbres3d: () => (etat.get("arbres")!.actif && rendu === "volume" ? derniersArbres : null),
    passer2D: () => q<HTMLButtonElement>('.at-mode button[data-mode="2d"]').click(),
    legende: () => {
      const items: ElementLegende[] = [];
      for (const c of COUCHES) {
        const e = etat.get(c.id)!;
        if (!e.actif || c.id === "repere") continue;
        if (c.id === "fond") {
          if (fond !== "aucun") items.push({ titre: `Fond : ${FONDS[fond].titre}`, source: fond === "plan" ? "IGN Plan" : "IGN BD ORTHO®" });
          continue;
        }
        const it: ElementLegende = { titre: c.titre, source: c.source.replace(/ \(repli.*\)$/, "") };
        if (c.id === "bati") {
          if (coloration === "hauteur") it.pastilles = [...HAUTEURS.map((h) => ({ couleur: h.color, libelle: `${h.label} m` })), { couleur: INCONNU, libelle: "hauteur inconnue" }];
          else if (coloration === "usage") it.pastilles = [...USAGES.map((u) => ({ couleur: u.color, libelle: u.valeur })), { couleur: USAGE_AUTRE, libelle: "annexe, autre" }];
          else it.pastilles = [{ couleur: NEUTRE, libelle: "bâtiment" }];
          it.titre = coloration === "hauteur" ? "Bâtiments par hauteur" : coloration === "usage" ? "Bâtiments par usage" : "Bâtiments";
        }
        if (c.id === "arbres") it.pastilles = [{ couleur: rendu === "volume" ? "#3a7a30" : "#3f8f3a", libelle: "arbre recensé" }];
        if (c.id === "vegetation") it.pastilles = [{ couleur: "#5f9e4b", libelle: "zone de végétation" }];
        if (c.id === "ombres") it.pastilles = [{ couleur: "#1f2a44", libelle: `ombres, ${dateInput.value} ${hourInput.value.replace(".25", "h15").replace(".5", "h30").replace(".75", "h45")} h` }];
        if (c.id === "perimetre") it.pastilles = [{ couleur: "#3a3a3c", libelle: "périmètre d'analyse" }];
        if (c.id === "cosia") it.titre = `CoSIA ${millesime}`;
        if (c.id === "carroyage") it.titre = `Carroyage Lambert-93, pas de ${pas} m`;
        items.push(it);
      }
      return items;
    },
  });

  // Accès pour les tests automatiques (lecture seule de l'état de la carte).
  (root as HTMLElement & { __carte?: maplibregl.Map }).__carte = map;

  return { setSite, resize: () => map.resize() };
}
