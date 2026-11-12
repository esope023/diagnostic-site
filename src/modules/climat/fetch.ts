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
    timeoutMs: 90_000, // série de 60 ans : réponse lourde
  });
  if (!block?.time?.length) {
    throw new Error(`Réponse inexploitable pour le modèle ${model} (${window.id})`);
  }
  return block;
}

/** Période de référence des modèles, identique à celle des observations ERA5. */
export const MODEL_REFERENCE_WINDOW: ProjectionWindow = {
  id: "ref",
  label: "Référence modèle 1991-2020",
  start: "1991-01-01",
  end: "2020-12-31",
};

/** Séries d'un modèle : horizon futur et sa propre période de référence. */
export interface ModelSeries {
  model: string;
  future: DailyTemperatureBlock;
  /** 1991-2020 du même modèle ; null si indisponible (le modèle est alors écarté). */
  reference: DailyTemperatureBlock | null;
}

export interface ProjectionRaw {
  window: ProjectionWindow;
  /** Une entrée par modèle disponible ; un échec isolé est filtré, pas fatal. */
  perModel: ModelSeries[];
}

/** Découpe une série 1991-2050 sur une fenêtre [start, end] (dates ISO). */
function slice(block: DailyTemperatureBlock, w: ProjectionWindow): DailyTemperatureBlock {
  const idx: number[] = [];
  block.time.forEach((t, i) => {
    if (t >= w.start && t <= w.end) idx.push(i);
  });
  return {
    time: idx.map((i) => block.time[i]),
    temperature_2m_max: idx.map((i) => block.temperature_2m_max[i]),
    temperature_2m_min: idx.map((i) => block.temperature_2m_min[i]),
    temperature_2m_mean: idx.map((i) => block.temperature_2m_mean[i]),
  };
}

const FULL_WINDOW: ProjectionWindow = {
  id: "1991-2050",
  label: "Série complète 1991-2050",
  start: MODEL_REFERENCE_WINDOW.start,
  end: "2050-12-31",
};

/**
 * Projections par la méthode des écarts : pour chaque modèle, on récupère en
 * UNE requête la série 1991-2050 (référence ET horizons), gardée en cache un
 * an. Comparer directement un modèle aux observations confondrait son biais
 * avec le réchauffement (constaté le 12/11/2026 à Marseille : un modèle compte
 * 21 nuits tropicales de trop dès 1991-2020).
 *
 * Seuls les modèles complets sont gardés, et ce sont les mêmes pour tous les
 * horizons : sinon 2030 et 2050 seraient calculés sur des modèles différents
 * et deviendraient incomparables (constaté avec des refus 429 partiels).
 */
export async function fetchProjections(ctx: SiteContext): Promise<ProjectionRaw[]> {
  const series = new Map<string, DailyTemperatureBlock>();
  // Une requête à la fois (Open-Meteo limite les requêtes lourdes).
  for (const model of PROJECTION_MODELS) {
    try {
      series.set(model, await fetchProjectionModel(ctx, model, FULL_WINDOW));
    } catch {
      /* modèle indisponible : écarté de l'ensemble, pas fatal */
    }
  }
  return PROJECTION_WINDOWS.map((window) => ({
    window,
    perModel: [...series].map(([model, full]) => ({
      model,
      future: slice(full, window),
      reference: slice(full, MODEL_REFERENCE_WINDOW),
    })),
  }));
}

/** Forme combinée consommée par le module (contrat DiagnosticModule : un seul Raw). */
export interface ClimatModuleRaw {
  baseline: ClimatRaw;
  projections: ProjectionRaw[];
  site: { lat: number; lon: number; timezone: string };
}

/**
 * Températures moyennes journalières observées (ERA5) de 1950 à 2025, pour les
 * bandes de réchauffement. Une seule variable : requête légère, cache long.
 * Non bloquant : en cas d'échec, la fiche le dit et le reste s'affiche.
 */
export async function fetchObserve(
  ctx: Pick<SiteContext, "lat" | "lon" | "timezone">,
): Promise<{ time: string[]; temperature_2m_mean: number[] } | null> {
  const url =
    `${OPEN_METEO.archive}?latitude=${ctx.lat}&longitude=${ctx.lon}` +
    `&start_date=1950-01-01&end_date=2025-12-31&daily=temperature_2m_mean` +
    `&timezone=${encodeURIComponent(ctx.timezone)}`;
  try {
    const { daily } = await fetchJson<{ daily: { time: string[]; temperature_2m_mean: number[] } }>(url, {
      cacheKey: "open-meteo:observe-1950-2025",
      ttlMs: 365 * 24 * 60 * 60 * 1000,
      timeoutMs: 60_000,
      retries: 4,
    });
    return daily?.time?.length ? daily : null;
  } catch {
    return null;
  }
}

export async function fetchClimatModule(ctx: SiteContext): Promise<ClimatModuleRaw> {
  const [baseline, projections] = await Promise.all([fetchClimat(ctx), fetchProjections(ctx)]);
  // La série 1950-2025 est chargée ensuite, par l'affichage : elle ne retarde
  // pas la fiche (Open-Meteo freine les requêtes lourdes successives).
  return { baseline, projections, site: { lat: ctx.lat, lon: ctx.lon, timezone: ctx.timezone } };
}
