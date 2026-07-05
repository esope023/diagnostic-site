// Récupération des données climat via Open-Meteo (archive ERA5 pour la
// référence, Climate API/CMIP6 pour les projections).
// Période normale de référence : 1991-2020 (standard OMM).
import { fetchJson } from "../../api/client";
import { OPEN_METEO } from "../../api/endpoints";
import type { SiteContext } from "../../core/types";
import type { DailyTemperatureBlock } from "./compute";

/** Forme brute renvoyée par l'API archive (champs "daily"). */
export interface ClimatRaw {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    temperature_2m_mean: number[];
    et0_fao_evapotranspiration: number[];
    shortwave_radiation_sum: number[];
    precipitation_sum: number[];
  };
}

const NORMAL_START = "1991-01-01";
const NORMAL_END = "2020-12-31";

export async function fetchClimat(ctx: SiteContext): Promise<ClimatRaw> {
  const daily = [
    "temperature_2m_max",
    "temperature_2m_min",
    "temperature_2m_mean",
    "et0_fao_evapotranspiration",
    "shortwave_radiation_sum",
    "precipitation_sum",
  ].join(",");

  const url =
    `${OPEN_METEO.archive}?latitude=${ctx.lat}&longitude=${ctx.lon}` +
    `&start_date=${NORMAL_START}&end_date=${NORMAL_END}` +
    `&daily=${daily}&timezone=${encodeURIComponent(ctx.timezone)}`;

  // 30 ans de données journalières : lourd mais mis en cache 30 j.
  return fetchJson<ClimatRaw>(url, {
    cacheKey: "open-meteo:normales-1991-2020",
    ttlMs: 90 * 24 * 60 * 60 * 1000,
    timeoutMs: 40_000,
  });
}

// ---------------------------------------------------------------------------
// Projections climatiques (CMIP6 via Open-Meteo Climate API).
//
// Choix : une requête PAR MODÈLE plutôt qu'une requête multi-modèles. L'API
// change le format de la réponse JSON quand plusieurs modèles sont demandés
// ensemble (suffixage des clés par modèle) ; plutôt que de deviner cette
// convention, on fait 3 requêtes simples à réponse standard et on moyenne
// les indicateurs nous-mêmes (voir compute.ts). Chaque requête est mise en
// cache longtemps : coût payé une fois par site, pas à chaque visite.
//
// Modèles retenus : les 3 avec couverture température complète (voir tableau
// Open-Meteo) et origines diverses, pour un ensemble simplifié — pas les 7
// modèles disponibles, pour limiter le volume de données côté navigateur.
// L'API ne propose pas de scénario d'émission au choix : elle est calée sur
// une trajectoire proche de RCP8.5 jusqu'en 2050 (date au-delà de laquelle
// l'API ne fournit plus de données).
export const PROJECTION_MODELS = ["EC_Earth3P_HR", "MRI_AGCM3_2_S", "CMCC_CM2_VHR4"];

export interface ProjectionWindow {
  id: string;
  label: string;
  start: string;
  end: string;
}

// Bornées par la limite de l'API (données jusqu'à fin 2050) : "horizon 2050"
// est donc la fin de la période disponible, pas un point précis à cette date.
export const PROJECTION_WINDOWS: ProjectionWindow[] = [
  { id: "2030", label: "Horizon 2030 (2021-2035)", start: "2021-01-01", end: "2035-12-31" },
  { id: "2050", label: "Horizon 2050 (2036-2050)", start: "2036-01-01", end: "2050-12-31" },
];

async function fetchProjectionModel(
  ctx: SiteContext,
  model: string,
  window: ProjectionWindow,
): Promise<DailyTemperatureBlock> {
  const daily = "temperature_2m_max,temperature_2m_min,temperature_2m_mean";
  const url =
    `${OPEN_METEO.climate}?latitude=${ctx.lat}&longitude=${ctx.lon}` +
    `&start_date=${window.start}&end_date=${window.end}` +
    `&models=${model}&daily=${daily}`;

  // Comme l'API archive, les séries journalières sont imbriquées sous "daily",
  // pas à la racine de la réponse.
  const { daily: block } = await fetchJson<{ daily: DailyTemperatureBlock }>(url, {
    cacheKey: `open-meteo:climate-${model}-${window.id}`,
    ttlMs: 365 * 24 * 60 * 60 * 1000, // projections CMIP6 : ne changent pas d'une visite à l'autre
    timeoutMs: 40_000,
  });
  if (!block?.time?.length) {
    throw new Error(`Réponse inexploitable pour le modèle ${model} (${window.id})`);
  }
  return block;
}

export interface ProjectionRaw {
  window: ProjectionWindow;
  /** Une entrée par modèle (voir PROJECTION_MODELS) ; un échec isolé est filtré, pas fatal. */
  perModel: DailyTemperatureBlock[];
}

export async function fetchProjections(ctx: SiteContext): Promise<ProjectionRaw[]> {
  const results: ProjectionRaw[] = [];

  for (const window of PROJECTION_WINDOWS) {
    const settled = await Promise.allSettled(
      PROJECTION_MODELS.map((model) => fetchProjectionModel(ctx, model, window)),
    );
    const perModel = settled
      .filter((r): r is PromiseFulfilledResult<DailyTemperatureBlock> => r.status === "fulfilled")
      .map((r) => r.value);
    results.push({ window, perModel });
  }

  return results;
}

/** Forme combinée consommée par le module (contrat DiagnosticModule : un seul Raw). */
export interface ClimatModuleRaw {
  baseline: ClimatRaw;
  projections: ProjectionRaw[];
}

export async function fetchClimatModule(ctx: SiteContext): Promise<ClimatModuleRaw> {
  const [baseline, projections] = await Promise.all([fetchClimat(ctx), fetchProjections(ctx)]);
  return { baseline, projections };
}
