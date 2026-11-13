// Catalogue des couches de l'Atelier cartographique. Toutes sont des données
// publiques sans clé, vérifiées le 12/11/2026 (réponse et CORS) :
//   - Géoplateforme IGN : WMTS (fonds), WMS-V (cadastre, urbanisme, espaces
//     protégés), WFS (bâti et végétation BD TOPO) ;
//   - Géorisques : WMS (retrait-gonflement des argiles) ;
//   - OpenStreetMap (Overpass) : arbres isolés.

import { IGN_WMTS, IGN_LAYERS } from "../api/endpoints";

export type Famille = "Fond" | "Occupation du sol" | "Parcelles" | "Bâti" | "Végétation" | "Soleil" | "Urbanisme" | "Risques · Nature" | "Repères";

export interface CoucheDef {
  id: string;
  famille: Famille;
  titre: string;
  source: string;
  /** Active à l'ouverture. */
  active: boolean;
  /** Opacité initiale (0-1). */
  opacite: number;
  /** Couche raster (tuiles) : modèle d'URL MapLibre. */
  tuiles?: string;
  /** Zoom maximal servi par la source (au-delà : agrandissement). */
  zoomMax?: number;
  /** Légende servie par le service (image), pour les couches WMS. */
  legende?: string;
  /** Mention affichée sous le titre (limites, hypothèses). */
  note?: string;
}

const WMS_V = "https://data.geopf.fr/wms-v/ows";
const GEORISQUES = "https://www.georisques.gouv.fr/services";

function wms(base: string, layers: string): string {
  return (
    `${base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layers}&STYLES=` +
    `&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true`
  );
}
function legendeWms(base: string, layer: string): string {
  return `${base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=${layer}&FORMAT=image/png&SLD_VERSION=1.1.0`;
}
function wmts(def: { layer: string; format: string }): string {
  return IGN_WMTS.replace("{layer}", def.layer).replace("{format}", def.format);
}

/** CoSIA (Couverture du Sol par IA, IGN) : un millésime par période de prise
 * de vue ; la couverture 2024-2026 est en cours de production. */
export const COSIA = {
  "2017-2020": "IGNF_COSIA_2017-2020",
  "2021-2023": "IGNF_COSIA_2021-2023",
  "2024-2026": "IGNF_COSIA_2024-2026",
} as const;
export type MillesimeCosia = keyof typeof COSIA;
export function tuilesCosia(m: MillesimeCosia): string {
  return wmts({ layer: COSIA[m], format: "image/png" });
}

/** Pas du carroyage Lambert-93 (m). */
export const PAS_CARROYAGE = [50, 100, 200, 500] as const;

export const FONDS = {
  plan: { titre: "Plan", tuiles: wmts(IGN_LAYERS.plan) },
  photo: { titre: "Photo", tuiles: wmts(IGN_LAYERS.ortho) },
  aucun: { titre: "Aucun", tuiles: "" },
} as const;
export type Fond = keyof typeof FONDS;

export const COUCHES: CoucheDef[] = [
  { id: "fond", famille: "Fond", titre: "Fond de carte", source: "IGN Plan / BD ORTHO®", active: true, opacite: 0.7 },
  {
    id: "cosia",
    famille: "Occupation du sol",
    titre: "CoSIA, couverture du sol",
    source: "IGN, couverture du sol par intelligence artificielle",
    active: false,
    opacite: 0.65,
    tuiles: wmts({ layer: COSIA["2021-2023"], format: "image/png" }),
    zoomMax: 18,
    // Légende publiée par l'IGN dans les capacités WMTS (la même pour les trois millésimes).
    legende: "https://data.geopf.fr/annexes/ressources/legendes/CoSIA-legend.png",
    note: "Classes déduites des photos aériennes par l'IGN : une aide à la lecture, à vérifier sur place.",
  },
  {
    id: "cadastre",
    famille: "Parcelles",
    titre: "Cadastre",
    source: "IGN Parcellaire Express",
    active: true,
    opacite: 0.8,
    tuiles: wms(WMS_V, "parcellaire_express_parcelle_noir,parcellaire_express_numero"),
  },
  { id: "bati", famille: "Bâti", titre: "Bâtiments", source: "IGN BD TOPO® (repli OpenStreetMap)", active: true, opacite: 1 },
  {
    id: "arbres",
    famille: "Végétation",
    titre: "Arbres isolés",
    source: "OpenStreetMap",
    active: true,
    opacite: 0.9,
    note: "En 3D, chaque arbre prend la hauteur et le houppier renseignés dans OpenStreetMap ; à défaut, une taille générique (8 à 16 m de haut, houppier de 6 à 11 m), variée pour la lisibilité.",
  },
  { id: "vegetation", famille: "Végétation", titre: "Zones de végétation", source: "IGN BD TOPO®", active: false, opacite: 0.5 },
  {
    id: "ombres",
    famille: "Soleil",
    titre: "Ombres portées",
    source: "Calcul à partir des hauteurs BD TOPO® et des arbres OSM",
    active: false,
    opacite: 0.4,
    note: "Bâtiments et arbres, sol plat, toits plats, relief non pris en compte. Ombre des arbres indicative quand leur taille n'est pas renseignée. La lumière de la carte suit le soleil.",
  },
  {
    id: "zonage",
    famille: "Urbanisme",
    titre: "Zonage du PLU",
    source: "Géoportail de l'Urbanisme",
    active: false,
    opacite: 0.55,
    tuiles: wms(WMS_V, "zone_secteur"),
    legende: legendeWms(WMS_V, "zone_secteur"),
  },
  {
    id: "prescriptions",
    famille: "Urbanisme",
    titre: "Prescriptions",
    source: "Géoportail de l'Urbanisme",
    active: false,
    opacite: 0.7,
    tuiles: wms(WMS_V, "prescription"),
    legende: legendeWms(WMS_V, "prescription"),
  },
  {
    id: "servitudes",
    famille: "Urbanisme",
    titre: "Servitudes d'utilité publique",
    source: "Géoportail de l'Urbanisme",
    active: false,
    opacite: 0.7,
    tuiles: wms(WMS_V, "sup"),
  },
  {
    id: "argiles",
    famille: "Risques · Nature",
    titre: "Argiles (retrait-gonflement)",
    source: "Géorisques",
    active: false,
    opacite: 0.55,
    tuiles: wms(GEORISQUES, "ALEARG"),
    legende: legendeWms(GEORISQUES, "ALEARG"),
  },
  {
    id: "protegees",
    famille: "Risques · Nature",
    titre: "Espaces protégés",
    source: "INPN : Natura 2000, ZNIEFF 1 et 2",
    active: false,
    opacite: 0.55,
    tuiles: wms(WMS_V, "Natura_2000,Patrinat_ZNIEFF2_France,Patrinat_ZNIEFF1_France"),
  },
  { id: "perimetre", famille: "Repères", titre: "Périmètre d'analyse", source: "Diagnostic", active: true, opacite: 1 },
  { id: "repere", famille: "Repères", titre: "Repère du site", source: "Point analysé", active: true, opacite: 1 },
  { id: "carroyage", famille: "Repères", titre: "Carroyage", source: "Lambert-93 (RGF93)", active: false, opacite: 0.45 },
];

export const FAMILLES: Famille[] = ["Fond", "Occupation du sol", "Parcelles", "Bâti", "Végétation", "Soleil", "Urbanisme", "Risques · Nature", "Repères"];

/** Classes de hauteur (m) : rampe séquentielle claire → foncée. */
export const HAUTEURS = [
  // Rampe douce (beige → terracotta), choisie à l'œil dans le Chrome de
  // Cédric le 13/11 : lisible en 3D sans couleurs criardes.
  { max: 6, color: "#f2ebe0", label: "< 6" },
  { max: 12, color: "#e7d8c1", label: "6–12" },
  { max: 20, color: "#d8bf9f", label: "12–20" },
  { max: 35, color: "#c19c7c", label: "20–35" },
  { max: Infinity, color: "#9c7562", label: "> 35" },
];
export const INCONNU = "#c9c6c0";

/** Usages BD TOPO (attribut usage_1) : palette catégorielle de référence,
 * dans son ordre fixe (contrôlée pour la vision des couleurs) ; annexes et
 * usages indifférenciés en gris. */
export const USAGES: { valeur: string; color: string }[] = [
  { valeur: "Résidentiel", color: "#2a78d6" },
  { valeur: "Commercial et services", color: "#eb6834" },
  { valeur: "Industriel", color: "#1baf7a" },
  { valeur: "Agricole", color: "#eda100" },
  { valeur: "Religieux", color: "#e87ba4" },
  { valeur: "Sportif", color: "#008300" },
];
export const USAGE_AUTRE = "#b8b8bd";
export const NEUTRE = "#e6e2da";
