// ---------------------------------------------------------------------------
// Points d'entrée des API publiques. Centralisés ici pour n'avoir qu'un
// seul endroit à corriger si une URL change.
//
// CORS :
//   - Open-Meteo, BAN, Overpass, tuiles IGN  -> appelables direct du navigateur.
//   - PVGIS  -> BLOQUE l'AJAX. Passer par PROXY_BASE (Cloudflare Worker).
//     Voir README §"Proxy PVGIS".
// ---------------------------------------------------------------------------

/** Base d'un éventuel proxy (Cloudflare Worker) pour les API sans CORS. */
export const PROXY_BASE = import.meta.env.VITE_PROXY_BASE ?? "";

/**
 * URL de la page héliodon historique (extrusion réelle des bâtiments, ombres
 * portées, orthophoto au sol, calque LiDAR HD) — bien plus aboutie visuellement
 * que l'aperçu 3D simplifié intégré au module Soleil. Le module s'y lie plutôt
 * que de dupliquer ce travail. À adapter si l'URL de déploiement change.
 */
export const LEGACY_HELIODON_URL =
  import.meta.env.VITE_LEGACY_HELIODON_URL ?? "https://esope023.github.io/Analyse/heliodon.html";

export const OPEN_METEO = {
  /** Archive/réanalyse ERA5 — normales, historique. */
  archive: "https://archive-api.open-meteo.com/v1/archive",
  /** Prévision (indice UV, court terme). */
  forecast: "https://api.open-meteo.com/v1/forecast",
  /** Projections climatiques CMIP6 descendues en résolution (scénarios). */
  climate: "https://climate-api.open-meteo.com/v1/climate",
};

/** Base Adresse Nationale — géocodage FR. */
export const BAN_SEARCH = "https://api-adresse.data.gouv.fr/search/";

/** Service altimétrique Géoplateforme (RGE ALTI). */
export const IGN_ALTI =
  "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";

/** WMTS IGN (tuiles libres, sans clé). */
export const IGN_WMTS =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
  "&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}" +
  "&LAYER={layer}&FORMAT={format}";

export const IGN_LAYERS = {
  plan: { layer: "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", format: "image/png" },
  ortho: { layer: "ORTHOIMAGERY.ORTHOPHOTOS", format: "image/jpeg" },
};

/** Overpass (OSM) — trame verte/bleue, morphologie urbaine. */
export const OVERPASS = "https://overpass-api.de/api/interpreter";

/**
 * WMS Géoplateforme (GetMap) — image orthophoto centrée sur un point, utilisée
 * comme texture de sol dans l'héliodon 3D. `sizeM` = côté du carré (mètres).
 */
export function ignWmsOrthoImage(
  lat: number,
  lon: number,
  sizeM: number,
  pixels = 512,
): string {
  const R = 6378137;
  const x = R * (lon * Math.PI) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const half = sizeM / 2;
  const bbox = [x - half, y - half, x + half, y + half].join(",");
  return (
    `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS&STYLES=&CRS=EPSG:3857&BBOX=${bbox}` +
    `&WIDTH=${pixels}&HEIGHT=${pixels}&FORMAT=image/jpeg`
  );
}

/**
 * WFS Géoplateforme — Parcellaire Express (PCI), couche parcelles cadastrales.
 * Typename et attributs (contenance, section, numero, code_com) confirmés au
 * moment de l'écriture. Schéma stable depuis plusieurs années, mais en cas de
 * changement le module cadastre dégrade sur "parcelle non disponible" plutôt
 * que d'afficher une donnée fausse.
 */
export function ignWfsParcelles(bbox: {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}): string {
  const { minLat, minLon, maxLat, maxLon } = bbox;
  return (
    `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&OUTPUTFORMAT=application/json` +
    `&SRSNAME=EPSG:4326&BBOX=${minLat},${minLon},${maxLat},${maxLon},EPSG:4326`
  );
}

/**
 * WFS Géoplateforme — BD TOPO® bâtiments (avec attribut hauteur).
 * NB : le nom de couche ("BDTOPO_V3:batiment") et le nom d'attribut hauteur
 * sont ceux publiés au moment de l'écriture ; à vérifier au premier test
 * (GetCapabilities peut évoluer). En cas d'échec, le module Soleil bascule
 * automatiquement sur OSM (src/core/osm-buildings.ts).
 */
export function ignWfsBatiments(bbox: {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}): string {
  const { minLat, minLon, maxLat, maxLon } = bbox;
  return (
    `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=BDTOPO_V3:batiment&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326` +
    `&BBOX=${minLat},${minLon},${maxLat},${maxLon},EPSG:4326`
  );
}

/** PVGIS 5.3 (via proxy obligatoire). tool = "seriescalc" | "PVcalc" | ... */
export function pvgis(tool: string): string {
  const base = `https://re.jrc.ec.europa.eu/api/v5_3/${tool}`;
  return PROXY_BASE ? `${PROXY_BASE}?url=${encodeURIComponent(base)}` : base;
}

/**
 * API Carto — module Urbanisme (GPU : Géoportail de l'Urbanisme). Couches
 * confirmées : zone-urba, municipality, assiette-sup-s/l/p. Format : GET avec
 * geom=<GeoJSON géométrie> (Point ou Polygone), réponse GeoJSON.
 */
export const APICARTO_GPU_BASE = "https://apicarto.ign.fr/api/gpu";

export function gpuZoneUrba(geom: object): string {
  return `${APICARTO_GPU_BASE}/zone-urba?geom=${encodeURIComponent(JSON.stringify(geom))}`;
}
export function gpuMunicipality(insee: string): string {
  return `${APICARTO_GPU_BASE}/municipality?insee=${insee}`;
}
export function gpuSup(layer: "assiette-sup-s" | "assiette-sup-l" | "assiette-sup-p", geom: object): string {
  return `${APICARTO_GPU_BASE}/${layer}?geom=${encodeURIComponent(JSON.stringify(geom))}`;
}

/** API du Géoportail de l'Urbanisme — détails d'un document (lien règlement PDF). */
export function gpuDocumentDetails(partition: string): string {
  return `https://www.geoportail-urbanisme.gouv.fr/api/document/${partition}/details`;
}

/**
 * API Géorisques (BRGM). Endpoints confirmés : /rga (fiable, dédié), et
 * /resultats_rapport_risque (synthèse multi-risques en un appel — pratique
 * mais signalé instable par des utilisateurs de l'API sur certaines périodes ;
 * traité défensivement, voir reglementaire/fetch.ts).
 */
export const GEORISQUES_BASE = "https://georisques.gouv.fr/api/v1";

export function georisquesRga(lat: number, lon: number): string {
  return `${GEORISQUES_BASE}/rga?latlon=${lon},${lat}`;
}
export function georisquesSynthese(lat: number, lon: number): string {
  return `${GEORISQUES_BASE}/resultats_rapport_risque?latlon=${lon},${lat}`;
}
export function georisquesCatnat(lat: number, lon: number, rayonM = 1000): string {
  return `${GEORISQUES_BASE}/gaspar/catnat?longitude=${lon}&latitude=${lat}&rayon=${rayonM}&page_size=50`;
}

/**
 * API Carto — module Nature (zonages de protection : Natura 2000, ZNIEFF,
 * réserves, parcs). Couches confirmées par la doc IGN ; le SEGMENT D'URL de
 * chaque couche (ex. "natura-habitat" vs "sic") n'a pas pu être vérifié en
 * direct — à confirmer au premier test réel (voir note dans
 * nature/fetch.ts). Format : GET avec geom=<GeoJSON Point ou Polygone>.
 */
export const APICARTO_NATURE_BASE = "https://apicarto.ign.fr/api/nature";

export function natureLayerUrl(layer: string, geom: object): string {
  return `${APICARTO_NATURE_BASE}/${layer}?geom=${encodeURIComponent(JSON.stringify(geom))}`;
}

/**
 * Hub'Eau — API Piézométrie (BRGM/ADES). Sans clé, REST JSON. Recherche des
 * piézomètres par bbox, puis dernière mesure via chroniques (tri desc, size=1).
 * size=100 : l'API pagine (souvent 40+ stations dans un rayon de 15 km en
 * zone urbaine) et ne trie pas par distance — une page trop petite peut faire
 * rater une station plus proche et active au profit d'une plus lointaine et
 * à l'arrêt depuis des décennies (constaté en test).
 */
export const HUBEAU_PIEZO_BASE = "https://hubeau.eaufrance.fr/api/v1/niveaux_nappes";

export function hubeauStations(bbox: {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}): string {
  const { minLat, minLon, maxLat, maxLon } = bbox;
  return `${HUBEAU_PIEZO_BASE}/stations?bbox=${minLon},${minLat},${maxLon},${maxLat}&size=100&format=json`;
}
export function hubeauDerniereMesure(codeBss: string): string {
  return `${HUBEAU_PIEZO_BASE}/chroniques?code_bss=${encodeURIComponent(codeBss)}&sort=desc&size=1&format=json`;
}
