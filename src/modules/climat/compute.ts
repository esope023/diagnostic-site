// Calculs climat : normales mensuelles, DJU, nuits tropicales, forte chaleur.
// Pur, sans I/O. Facile à tester unitairement.
import type { ClimatRaw } from "./fetch";

export interface ClimatResult {
  years: number;
  /** Normales mensuelles (12 valeurs, index 0 = janvier). */
  monthly: {
    tMax: number[];
    tMin: number[];
    tMean: number[];
    precip: number[]; // cumul mensuel moyen (mm)
    et0: number[]; // cumul mensuel moyen (mm)
    rayonnement: number[]; // cumul mensuel moyen (MJ/m²)
  };
  /** Degrés-jours unifiés annuels moyens (base 18 °C). */
  djuChauffage: number;
  djuClim: number;
  /** Moyenne annuelle du nombre de nuits tropicales (Tmin ≥ 20 °C). */
  nuitsTropicales: number;
  /** Jours de forte chaleur (Tmax ≥ 30 °C) et très forte (≥ 35 °C), moy./an. */
  joursChaleur30: number;
  joursChaleur35: number;
  /** Nombre moyen d'épisodes de vague de chaleur (≥ 3 j consécutifs Tmax ≥ 30). */
  vaguesChaleur: number;
  tMoyenneAnnuelle: number;
  /** Horizons de projection (2030/2050), calculés séparément et attachés ici
   * par index.ts pour rester dans le contrat DiagnosticModule (un seul Result). */
  projections: ProjectionHorizon[];
}

/** Sous-ensemble d'indicateurs partagé entre la référence et les projections
 * (mêmes seuils, même méthode — condition nécessaire pour une comparaison valide). */
export interface TemperatureIndicators {
  years: number;
  tMoyenneAnnuelle: number;
  djuChauffage: number;
  djuClim: number;
  nuitsTropicales: number;
  joursChaleur30: number;
  joursChaleur35: number;
  vaguesChaleur: number;
}

export interface DailyTemperatureBlock {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  temperature_2m_mean: number[];
}

const monthOf = (isoDate: string): number => Number(isoDate.slice(5, 7)) - 1;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Indicateurs annuels calculés à partir d'une série journalière de
 * températures. Utilisé identiquement pour la référence (ERA5 1991-2020) et
 * pour chaque horizon de projection (CMIP6) — mêmes seuils, sinon les deltas
 * référence/projection n'auraient aucun sens.
 */
export function computeTemperatureIndicators(daily: DailyTemperatureBlock): TemperatureIndicators {
  const n = daily.time.length;
  const years = new Set(daily.time.map((t) => t.slice(0, 4))).size || 1;

  const BASE_CHAUFF = 18;
  const BASE_CLIM = 18;
  let djuChauff = 0;
  let djuClim = 0;
  let nuitsTrop = 0;
  let jours30 = 0;
  let jours35 = 0;
  let vagues = 0;
  let run = 0;

  for (let i = 0; i < n; i++) {
    const tmean = daily.temperature_2m_mean[i];
    const tmin = daily.temperature_2m_min[i];
    const tmax = daily.temperature_2m_max[i];

    if (tmean < BASE_CHAUFF) djuChauff += BASE_CHAUFF - tmean;
    if (tmean > BASE_CLIM) djuClim += tmean - BASE_CLIM;
    if (tmin >= 20) nuitsTrop++;
    if (tmax >= 30) jours30++;
    if (tmax >= 35) jours35++;

    if (tmax >= 30) {
      run++;
      if (run === 3) vagues++;
    } else {
      run = 0;
    }
  }

  return {
    years,
    tMoyenneAnnuelle: round1(mean(daily.temperature_2m_mean)),
    djuChauffage: Math.round(djuChauff / years),
    djuClim: Math.round(djuClim / years),
    nuitsTropicales: round1(nuitsTrop / years),
    joursChaleur30: round1(jours30 / years),
    joursChaleur35: round1(jours35 / years),
    vaguesChaleur: round1(vagues / years),
  };
}

const yearOf = (isoDate: string): number => Number(isoDate.slice(0, 4));

export function computeClimat(raw: ClimatRaw): Omit<ClimatResult, "projections"> {
  const d = raw.daily;
  const n = d.time.length;

  const years = new Set(d.time.map(yearOf)).size;

  // --- Normales mensuelles ---------------------------------------------------
  // On accumule par mois puis on divise par le nombre d'années pour les cumuls,
  // et on moyenne pour les températures.
  const tMaxByMonth: number[][] = Array.from({ length: 12 }, () => []);
  const tMinByMonth: number[][] = Array.from({ length: 12 }, () => []);
  const tMeanByMonth: number[][] = Array.from({ length: 12 }, () => []);
  const precipSumByMonth = new Array(12).fill(0);
  const et0SumByMonth = new Array(12).fill(0);
  const radSumByMonth = new Array(12).fill(0);

  for (let i = 0; i < n; i++) {
    const m = monthOf(d.time[i]);
    tMaxByMonth[m].push(d.temperature_2m_max[i]);
    tMinByMonth[m].push(d.temperature_2m_min[i]);
    tMeanByMonth[m].push(d.temperature_2m_mean[i]);
    precipSumByMonth[m] += d.precipitation_sum[i] ?? 0;
    et0SumByMonth[m] += d.et0_fao_evapotranspiration[i] ?? 0;
    radSumByMonth[m] += d.shortwave_radiation_sum[i] ?? 0;
  }

  const monthly = {
    tMax: tMaxByMonth.map((v) => round1(mean(v))),
    tMin: tMinByMonth.map((v) => round1(mean(v))),
    tMean: tMeanByMonth.map((v) => round1(mean(v))),
    precip: precipSumByMonth.map((s) => round1(s / years)),
    et0: et0SumByMonth.map((s) => round1(s / years)),
    rayonnement: radSumByMonth.map((s) => round1(s / years)),
  };

  // Indicateurs annuels : même fonction que pour les projections (voir plus
  // bas), pour garantir une méthode strictement identique.
  const indicators = computeTemperatureIndicators(d);

  return { monthly, ...indicators };
}

// ---------------------------------------------------------------------------
// Projections climatiques (CMIP6, via Open-Meteo Climate API).
// ---------------------------------------------------------------------------

export interface ProjectionHorizon {
  id: string;
  label: string;
  indicators: TemperatureIndicators;
  /** Écart absolu vs référence 1991-2020. */
  deltaTemp: number;
  deltaNuitsTropicales: number;
  deltaJours30: number;
  deltaVagues: number;
  /** Écart en %, null si la référence vaut 0 (pas de % significatif). */
  pctNuitsTropicales: number | null;
  pctJours30: number | null;
  pctVagues: number | null;
}

function pctChange(base: number, future: number): number | null {
  if (base <= 0) return null; // "apparition" d'un phénomène, pas un % exploitable
  return Math.round(((future - base) / base) * 1000) / 10;
}

/**
 * Moyenne les indicateurs de plusieurs modèles CMIP6 pour un même horizon
 * (ensemble simplifié à 3 modèles, voir fetch.ts) et calcule les écarts vs
 * référence 1991-2020.
 */
export function computeProjectionHorizon(
  id: string,
  label: string,
  perModelDaily: DailyTemperatureBlock[],
  baseline: TemperatureIndicators,
): ProjectionHorizon {
  const perModel = perModelDaily.map(computeTemperatureIndicators);
  const avg = (pick: (t: TemperatureIndicators) => number) =>
    round1(mean(perModel.map(pick)));

  const indicators: TemperatureIndicators = {
    years: perModel[0]?.years ?? 0,
    tMoyenneAnnuelle: avg((t) => t.tMoyenneAnnuelle),
    djuChauffage: Math.round(avg((t) => t.djuChauffage)),
    djuClim: Math.round(avg((t) => t.djuClim)),
    nuitsTropicales: avg((t) => t.nuitsTropicales),
    joursChaleur30: avg((t) => t.joursChaleur30),
    joursChaleur35: avg((t) => t.joursChaleur35),
    vaguesChaleur: avg((t) => t.vaguesChaleur),
  };

  return {
    id,
    label,
    indicators,
    deltaTemp: round1(indicators.tMoyenneAnnuelle - baseline.tMoyenneAnnuelle),
    deltaNuitsTropicales: round1(indicators.nuitsTropicales - baseline.nuitsTropicales),
    deltaJours30: round1(indicators.joursChaleur30 - baseline.joursChaleur30),
    deltaVagues: round1(indicators.vaguesChaleur - baseline.vaguesChaleur),
    pctNuitsTropicales: pctChange(baseline.nuitsTropicales, indicators.nuitsTropicales),
    pctJours30: pctChange(baseline.joursChaleur30, indicators.joursChaleur30),
    pctVagues: pctChange(baseline.vaguesChaleur, indicators.vaguesChaleur),
  };
}
