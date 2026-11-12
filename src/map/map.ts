// Carte Leaflet avec fonds IGN Géoplateforme (WMTS libre, sans clé).
import L from "leaflet";
import { IGN_WMTS, IGN_LAYERS } from "../api/endpoints";
import type { SiteContext } from "../core/types";

function ignLayer(def: { layer: string; format: string }): L.TileLayer {
  const url = IGN_WMTS.replace("{layer}", def.layer).replace("{format}", def.format);
  return L.tileLayer(url, {
    attribution: "© IGN / Géoplateforme",
    maxZoom: 19,
    tileSize: 256,
  });
}

let map: L.Map | null = null;
let marker: L.Marker | null = null;
let onMarkerMoved: ((lat: number, lon: number) => void) | null = null;

/** Rappel appelé quand l'utilisateur fait glisser le repère du site. */
export function setMarkerMovedHandler(fn: (lat: number, lon: number) => void): void {
  onMarkerMoved = fn;
}

/** Replace le repère à une position (annulation d'un déplacement). */
export function resetMarker(lat: number, lon: number): void {
  marker?.setLatLng([lat, lon]);
}

/** Repère du site : point plein cerclé et croix de visée, dessiné en CSS/SVG
 * (pas d'image à charger, net à toutes les résolutions). */
const SITE_ICON = L.divIcon({
  className: "site-marker",
  html: `<svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
    <line x1="18" y1="1" x2="18" y2="11" /><line x1="18" y1="25" x2="18" y2="35" />
    <line x1="1" y1="18" x2="11" y2="18" /><line x1="25" y1="18" x2="35" y2="18" />
    <circle cx="18" cy="18" r="7" class="ring" /><circle cx="18" cy="18" r="3" class="dot" />
  </svg>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -16],
});
let analysisCircle: L.Circle | null = null;
let parcelleLayer: L.Polygon | null = null;

export function initMap(el: HTMLElement): L.Map {
  if (map) return map;

  const plan = ignLayer(IGN_LAYERS.plan);
  const ortho = ignLayer(IGN_LAYERS.ortho);

  map = L.map(el, { center: [46.6, 2.5], zoom: 6, layers: [plan] });
  L.control.layers({ "Plan IGN": plan, "Photo aérienne": ortho }).addTo(map);
  return map;
}

export function focusSite(ctx: SiteContext): void {
  if (!map) return;
  map.setView([ctx.lat, ctx.lon], 17);
  if (marker) marker.remove();
  marker = L.marker([ctx.lat, ctx.lon], {
    icon: SITE_ICON,
    title: `${ctx.label} — faites glisser pour déplacer le point d'analyse`,
    draggable: true,
    autoPan: true,
  })
    .addTo(map)
    .bindPopup(ctx.label)
    .openPopup();
  marker.on("dragstart", () => marker?.closePopup());
  marker.on("dragend", () => {
    const ll = marker!.getLatLng();
    onMarkerMoved?.(ll.lat, ll.lng);
  });
  updateAnalysisCircle(ctx);
  updateParcelleLayer(ctx);
}

/** Dessine (ou retire) le cercle de rayon d'analyse "quartier". */
export function updateAnalysisCircle(ctx: SiteContext): void {
  if (!map) return;
  if (analysisCircle) {
    analysisCircle.remove();
    analysisCircle = null;
  }
  if (ctx.radiusM !== null) {
    analysisCircle = L.circle([ctx.lat, ctx.lon], {
      radius: ctx.radiusM,
      color: "#2c7a7b",
      weight: 1.5,
      fillOpacity: 0.05,
    }).addTo(map);
  }
}

/** Dessine (ou retire) le contour de la vraie parcelle cadastrale, si trouvée. */
export function updateParcelleLayer(ctx: SiteContext): void {
  if (!map) return;
  if (parcelleLayer) {
    parcelleLayer.remove();
    parcelleLayer = null;
  }
  if (ctx.parcelle) {
    const latLngs = ctx.parcelle.polygon.map((p) => [p.lat, p.lon] as [number, number]);
    parcelleLayer = L.polygon(latLngs, {
      color: "#d35400",
      weight: 2,
      dashArray: "6 4",
      fillOpacity: 0.03,
    }).addTo(map);
    if (ctx.parcelle.reference) {
      parcelleLayer.bindTooltip(`Parcelle ${ctx.parcelle.reference}`);
    }
  }
}

export function getMapElement(): HTMLElement | null {
  return map ? map.getContainer() : null;
}
