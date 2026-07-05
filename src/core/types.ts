// ---------------------------------------------------------------------------
// Contrats partagés par tout l'outil.
// La colonne vertébrale, c'est SiteContext + DiagnosticModule.
// Tout nouveau module doit implémenter DiagnosticModule et se contenter
// de consommer le SiteContext. Rien d'autre.
// ---------------------------------------------------------------------------
import type { Parcelle } from "./cadastre";

/** Contexte du site, construit UNE fois après géocodage. Partagé par tous les modules. */
export interface SiteContext {
  /** Latitude WGS84 (degrés décimaux). */
  lat: number;
  /** Longitude WGS84 (degrés décimaux). */
  lon: number;
  /** Altitude en mètres (RGE ALTI via Géoplateforme), null si indisponible. */
  altitude: number | null;
  /** Libellé lisible retourné par le géocodage. */
  label: string;
  /** Code commune INSEE, si connu. */
  insee?: string;
  /** Nom de commune. */
  commune?: string;
  /** Code postal. */
  postcode?: string;
  /** Fuseau IANA (ex. "Europe/Paris"), utilisé par les API météo. */
  timezone: string;
  /**
   * Rayon d'analyse "quartier", en mètres. `null` = échelle parcelle : pas de
   * cercle affiché ; voir `parcelle` ci-dessous pour le contour cadastral réel.
   */
  radiusM: number | null;
  /** Parcelle cadastrale réelle (IGN PCI) si trouvée, null sinon — voir src/core/cadastre.ts. */
  parcelle: Parcelle | null;
}

/** Un graphe prêt à être rendu (par Chart.js) et exporté. */
export interface ChartSpec {
  title: string;
  /** Config Chart.js (type + data + options). Typée `unknown` pour rester découplé. */
  config: unknown;
}

/** Bloc d'export produit par un module. L'export global itère sur ces blocs. */
export interface ExportBlock {
  moduleId: string;
  title: string;
  /** Synthèse en 1-3 phrases, affichable et imprimable. */
  summary: string;
  /** Indicateurs chiffrés clés (label -> valeur formatée). */
  indicators: { label: string; value: string }[];
  /** Graphes à inclure dans le rapport. */
  charts: ChartSpec[];
  /** Mentions méthodo / limites (ex. "estimation qualitative"). */
  notes?: string[];
}

/**
 * Contrat que TOUS les modules respectent.
 *  - Raw    : forme brute renvoyée par les API (typée par chaque module)
 *  - Result : données calculées, prêtes à afficher et exporter
 */
export interface DiagnosticModule<Raw = unknown, Result = unknown> {
  /** Identifiant technique unique, ex. "climat". */
  readonly id: string;
  /** Libellé affiché, ex. "Climat". */
  readonly label: string;
  /** Emoji / pictogramme facultatif. */
  readonly icon?: string;
  /**
   * Portée du module :
   *  - "site"     : indépendant du rayon d'analyse (données de grille ou
   *                 propres au bâtiment — ex. Climat, Vent, Eau).
   *  - "quartier" : dépend du rayon choisi par l'utilisateur (ex. Nature,
   *                 Urbanisme, masques solaires). Consomme `ctx.radiusM`.
   * Un changement de rayon ne relance que les modules "quartier".
   */
  readonly scope: "site" | "quartier";

  /** Récupère les données brutes (via la couche API + cache). */
  fetchData(ctx: SiteContext): Promise<Raw>;
  /** Transforme le brut en indicateurs exploitables. Pur, sans I/O. */
  compute(raw: Raw, ctx: SiteContext): Result;
  /** Rend le résultat dans l'élément fourni. */
  render(el: HTMLElement, result: Result, ctx: SiteContext): void | Promise<void>;
  /** Produit le bloc d'export (stateless, à partir du seul Result). */
  toExport(result: Result, ctx: SiteContext): ExportBlock;
}

/** État d'exécution d'un module, pour piloter l'UI. */
export type ModuleStatus = "idle" | "loading" | "ready" | "error";
