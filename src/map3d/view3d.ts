// Vue 3D du site : MapLibre GL, chargée à la demande (import dynamique) pour
// ne pas alourdir le premier affichage. Couches activables :
//   - bâtiments extrudés (IGN BD TOPO®, repli OSM), colorés par hauteur ;
//   - ombres portées à une date et une heure légale choisies ;
//   - périmètre d'analyse ;
//   - fond Plan IGN ou photo aérienne.
// Tout est calculé à partir de données mesurées : la seule hypothèse est la
// hauteur de 9 m attribuée aux bâtiments sans hauteur connue, signalée en gris.

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { IGN_WMTS, IGN_LAYERS } from "../api/endpoints";
import { fetchBuildingsWithHeight, BUILDING_SOURCE_LABEL, type BuildingsResult } from "../core/buildings";
import type { BuildingFootprint } from "../core/osm-buildings";
import type { SiteContext } from "../core/types";
import { DEFAULT_HEIGHT_M, MAX_SHADOW_M, type ShadowBuilding } from "./shadows";
import type { ShadowRequest, ShadowResponse } from "./shadow-worker";
import { sunAtLegalTime, formatHour } from "./sun";

/** Classes de hauteur (m) et couleurs (rampe séquentielle claire → foncée). */
const HEIGHT_CLASSES = [
  { max: 6, color: "#fbe3b5", label: "< 6 m" },
  { max: 12, color: "#f6bd6b", label: "6 – 12 m" },
  { max: 20, color: "#ea8a3c", label: "12 – 20 m" },
  { max: 35, color: "#c9552a", label: "20 – 35 m" },
  { max: Infinity, color: "#8f2d1c", label: "> 35 m" },
];
const UNKNOWN_COLOR = "#b8b8b8";
const SHADOW_OPACITY = 0.38;
const SHADOW_COLOR = "#1f2a44";

export interface View3D {
  setSite(ctx: SiteContext): Promise<void>;
  /** À appeler quand le conteneur redevient visible. */
  resize(): void;
}

function tileUrl(def: { layer: string; format: string }): string {
  return IGN_WMTS.replace("{layer}", def.layer).replace("{format}", def.format);
}

function circlePolygon(lat: number, lon: number, radiusM: number, steps = 96): [number, number][] {
  const mLat = 110_540;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + (Math.sin(a) * radiusM) / mLon, lat + (Math.cos(a) * radiusM) / mLat]);
  }
  return ring;
}

function buildingsGeoJSON(buildings: BuildingFootprint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: buildings.map((b, i) => ({
      type: "Feature",
      id: i,
      geometry: {
        type: "Polygon",
        coordinates: [[...b.polygon.map((p) => [p.lon, p.lat]), [b.polygon[0].lon, b.polygon[0].lat]]],
      },
      properties: {
        h: b.heightM ?? DEFAULT_HEIGHT_M,
        known: b.heightM !== null,
        usage: b.info?.usage ?? "",
        etages: b.info?.etages ?? null,
        logements: b.info?.logements ?? null,
        date: b.info?.dateApparition ?? "",
      },
    })),
  };
}

function siteMarkerElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "site-marker";
  el.innerHTML = `<svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
    <line x1="18" y1="1" x2="18" y2="11" /><line x1="18" y1="25" x2="18" y2="35" />
    <line x1="1" y1="18" x2="11" y2="18" /><line x1="25" y1="18" x2="35" y2="18" />
    <circle cx="18" cy="18" r="7" class="ring" /><circle cx="18" cy="18" r="3" class="dot" />
  </svg>`;
  return el;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function createView3D(container: HTMLElement): View3D {
  container.innerHTML = `
    <div class="m3d-canvas"></div>
    <details class="m3d-panel m3d-layers" open>
      <summary>Couches</summary>
      <label><input type="checkbox" data-layer="buildings" checked> Bâtiments (hauteur)</label>
      <label><input type="checkbox" data-layer="shadows" checked> Ombres portées</label>
      <label><input type="checkbox" data-layer="perimeter" checked> Périmètre d'analyse</label>
      <fieldset class="m3d-base">
        <legend>Fond</legend>
        <label><input type="radio" name="m3d-base" value="plan" checked> Plan IGN</label>
        <label><input type="radio" name="m3d-base" value="ortho"> Photo aérienne</label>
      </fieldset>
      <div class="m3d-legend" aria-label="Légende des hauteurs">
        ${HEIGHT_CLASSES.map((c) => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join("")}
        <span><i style="background:${UNKNOWN_COLOR}"></i>inconnue (${DEFAULT_HEIGHT_M} m supposés)</span>
      </div>
      <p class="m3d-source"></p>
    </details>
    <div class="m3d-panel m3d-sun">
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
    <p class="m3d-status" hidden></p>`;

  const canvasEl = container.querySelector<HTMLElement>(".m3d-canvas")!;
  const dateInput = container.querySelector<HTMLInputElement>(".m3d-date")!;
  const hourInput = container.querySelector<HTMLInputElement>(".m3d-hour")!;
  const sunInfo = container.querySelector<HTMLElement>(".m3d-sun-info")!;
  const sourceEl = container.querySelector<HTMLElement>(".m3d-source")!;
  const statusEl = container.querySelector<HTMLElement>(".m3d-status")!;
  dateInput.value = todayIso();

  const colorExpr: maplibregl.ExpressionSpecification = [
    "case",
    ["!", ["get", "known"]],
    UNKNOWN_COLOR,
    [
      "step",
      ["get", "h"],
      HEIGHT_CLASSES[0].color,
      ...HEIGHT_CLASSES.slice(0, -1).flatMap((c, i) => [c.max, HEIGHT_CLASSES[i + 1].color]),
    ],
  ];

  const map = new maplibregl.Map({
    container: canvasEl,
    style: {
      version: 8,
      sources: {
        plan: { type: "raster", tiles: [tileUrl(IGN_LAYERS.plan)], tileSize: 256, maxzoom: 19, attribution: "© IGN / Géoplateforme" },
        ortho: { type: "raster", tiles: [tileUrl(IGN_LAYERS.ortho)], tileSize: 256, maxzoom: 19, attribution: "© IGN / Géoplateforme" },
        buildings: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        perimeter: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        shadows: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      },
      layers: [
        { id: "plan", type: "raster", source: "plan" },
        { id: "ortho", type: "raster", source: "ortho", layout: { visibility: "none" } },
        {
          // Ombres réunies (pas de recouvrement qui fonce), sous les bâtiments.
          id: "shadows",
          type: "fill",
          source: "shadows",
          paint: { "fill-color": SHADOW_COLOR, "fill-opacity": SHADOW_OPACITY, "fill-antialias": true },
        },
        {
          id: "perimeter",
          type: "line",
          source: "perimeter",
          paint: { "line-color": "#2c7a7b", "line-width": 2, "line-dasharray": [3, 2] },
        },
        {
          id: "buildings",
          type: "fill-extrusion",
          source: "buildings",
          paint: {
            "fill-extrusion-color": colorExpr,
            "fill-extrusion-height": ["get", "h"],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.92,
            "fill-extrusion-vertical-gradient": true,
          },
        },
      ],
    },
    center: [2.5, 46.6],
    zoom: 5,
    pitch: 55,
    bearing: -20,
    maxPitch: 75,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "top-right");

  const ready = new Promise<void>((resolve) => map.once("load", () => resolve()));
  let marker: maplibregl.Marker | null = null;
  let current: { ctx: SiteContext; data: BuildingsResult } | null = null;

  // --- Ombres (calculées dans un worker) -------------------------------------------
  const worker = new Worker(new URL("./shadow-worker.ts", import.meta.url), { type: "module" });
  let requestId = 0;
  let pending = false;
  let queued = false;

  function updateSunInfo(): { elevationDeg: number; azimuthDeg: number } | null {
    if (!current) return null;
    const { ctx } = current;
    const hour = Number(hourInput.value);
    const sun = sunAtLegalTime(ctx.lat, ctx.lon, dateInput.value || todayIso(), hour);
    const tz = sun.utcOffset === 2 ? "heure d'été" : "heure d'hiver";
    const night = sun.elevationDeg <= 0.5;
    const len10 = night ? 0 : Math.min(10 / Math.tan((sun.elevationDeg * Math.PI) / 180), MAX_SHADOW_M);
    sunInfo.innerHTML = night
      ? `<strong>${formatHour(hour)}</strong> (${tz}) — soleil sous l'horizon`
      : `<strong>${formatHour(hour)}</strong> (${tz}) · soleil à ${sun.elevationDeg.toFixed(0)}° de hauteur,
         azimut ${sun.azimuthDeg.toFixed(0)}° · un bâtiment de 10 m porte ${len10.toFixed(0)} m d'ombre`;
    return sun;
  }

  /** Une seule demande en cours ; pendant le glissement, seule la dernière position compte. */
  function requestShadows(): void {
    const sun = updateSunInfo();
    if (!sun) return;
    if (pending) {
      queued = true;
      return;
    }
    pending = true;
    worker.postMessage({
      kind: "compute",
      id: ++requestId,
      elevationDeg: sun.elevationDeg,
      azimuthDeg: sun.azimuthDeg,
    } satisfies ShadowRequest);
  }

  worker.onmessage = (e: MessageEvent<ShadowResponse>) => {
    pending = false;
    if (e.data.id === requestId) {
      (map.getSource("shadows") as maplibregl.GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: e.data.result.multiPolygon },
      });
    }
    if (queued) {
      queued = false;
      requestShadows();
    }
  };
  worker.onerror = () => {
    pending = false;
    sunInfo.insertAdjacentHTML("beforeend", " · <em>calcul des ombres indisponible</em>");
  };

  hourInput.addEventListener("input", requestShadows);
  dateInput.addEventListener("change", requestShadows);
  container.querySelectorAll<HTMLButtonElement>(".m3d-presets button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const year = (dateInput.value || todayIso()).slice(0, 4);
      dateInput.value = `${year}-${btn.dataset.md}`;
      requestShadows();
    });
  });

  // --- Couches ------------------------------------------------------------------
  container.querySelectorAll<HTMLInputElement>("input[data-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.layer!;
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", input.checked ? "visible" : "none");
    });
  });
  container.querySelectorAll<HTMLInputElement>('input[name="m3d-base"]').forEach((input) => {
    input.addEventListener("change", () => {
      map.setLayoutProperty("plan", "visibility", input.value === "plan" ? "visible" : "none");
      map.setLayoutProperty("ortho", "visibility", input.value === "ortho" ? "visible" : "none");
    });
  });
  // Panneau replié par défaut sur petit écran.
  if (window.matchMedia("(max-width: 800px)").matches) {
    container.querySelector<HTMLDetailsElement>(".m3d-layers")!.open = false;
  }

  // --- Fiche d'un bâtiment --------------------------------------------------------
  map.on("click", "buildings", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties as Record<string, unknown>;
    const rows = [
      `<strong>Hauteur :</strong> ${p.known ? `${Number(p.h).toFixed(1)} m` : `inconnue (${DEFAULT_HEIGHT_M} m supposés)`}`,
      p.usage ? `<strong>Usage :</strong> ${esc(String(p.usage))}` : "",
      p.etages ? `<strong>Étages :</strong> ${p.etages}` : "",
      p.logements ? `<strong>Logements :</strong> ${p.logements}` : "",
      p.date ? `<strong>Dans la base depuis :</strong> ${esc(String(p.date).slice(0, 10))}` : "",
    ].filter(Boolean);
    new maplibregl.Popup({ closeButton: true, maxWidth: "240px" })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="m3d-popup">${rows.join("<br>")}<br><span class="m3d-popup-src">${esc(sourceEl.dataset.source ?? "")}</span></div>`)
      .addTo(map);
  });
  map.on("mouseenter", "buildings", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "buildings", () => (map.getCanvas().style.cursor = ""));

  // --- Site -----------------------------------------------------------------------
  async function setSite(ctx: SiteContext): Promise<void> {
    await ready;
    const radius = ctx.radiusM ?? 150;

    (map.getSource("perimeter") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features:
        ctx.radiusM !== null
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: circlePolygon(ctx.lat, ctx.lon, ctx.radiusM) } }]
          : [],
    });
    marker?.remove();
    marker = new maplibregl.Marker({ element: siteMarkerElement() }).setLngLat([ctx.lon, ctx.lat]).addTo(map);
    map.jumpTo({ center: [ctx.lon, ctx.lat], zoom: radius > 400 ? 15.5 : 16.6, pitch: 55, bearing: -20 });

    statusEl.hidden = false;
    statusEl.textContent = "Chargement des bâtiments…";
    // Même rayon que le module Urbanisme : la réponse est déjà en cache.
    const data = await fetchBuildingsWithHeight(ctx, radius);
    current = { ctx, data };
    (map.getSource("buildings") as maplibregl.GeoJSONSource).setData(buildingsGeoJSON(data.buildings));

    const known = data.buildings.filter((b) => b.heightM !== null).length;
    const label = BUILDING_SOURCE_LABEL[data.source];
    sourceEl.dataset.source = `Source : ${label}`;
    sourceEl.textContent =
      data.source === "indisponible"
        ? "Bâtiments indisponibles (BD TOPO et OpenStreetMap n'ont pas répondu)."
        : `${data.buildings.length} bâtiments · ${label} · hauteur connue pour ${
            data.buildings.length ? Math.round((known / data.buildings.length) * 100) : 0
          } %. Ombres sur sol plat, toits plats ; relief, végétation et ombres sur les toits voisins non pris en compte.`;
    statusEl.hidden = data.source !== "indisponible";
    statusEl.textContent = data.source === "indisponible" ? "Bâtiments indisponibles — réessayez plus tard." : "";

    const shadowBuildings: ShadowBuilding[] = data.buildings.map((b) => ({
      ring: b.polygon.map((p) => [p.lon, p.lat] as [number, number]),
      heightM: b.heightM,
    }));
    worker.postMessage({ kind: "buildings", buildings: shadowBuildings, lat0: ctx.lat, lon0: ctx.lon } satisfies ShadowRequest);
    requestShadows();
  }

  return {
    setSite,
    resize: () => map.resize(),
  };
}
