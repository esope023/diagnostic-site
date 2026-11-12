// Calculs climat : normales mensuelles, DJU, nuits tropicales, forte chaleur.
// Pur, sans I/O. Facile à tester unitairement.
import type { ClimatRaw, ModelSeries } from "./fetch";

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
  /** Nuits tropicales par mois (moyenne annuelle, 12 valeurs, index 0 = janvier). */
  nuitsParMois: number[];
  /** Point du site, pour charger après coup la série observée 1950-2025. */
  site: { lat: number; lon: number; timezone: string };
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

export interface AnneeObservee {
  annee: number;
  t: number;
}

/**
 * Nombre moyen par an et par mois de nuits tropicales (Tmin ≥ 20 °C).
 * Rapporté au nombre d'années de données valides de chaque mois.
 */
export function nuitsTropicalesParMois(daily: DailyTemperatureBlock): number[] {
  const count = new Array(12).fill(0);
  const valid = new Array(12).fill(0);
  daily.time.forEach((t, i) => {
    const tmin = daily.temperature_2m_min[i];
    if (typeof tmin !== "number" || !Number.isFinite(tmin)) return;
    const m = monthOf(t);
    valid[m]++;
    if (tmin >= 20) count[m]++;
  });
  // Jours valides d'un mois / longueur moyenne du mois = années équivalentes.
  const LONGUEUR = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return count.map((c, m) => (valid[m] > 0 ? c / (valid[m] / LONGUEUR[m]) : 0));
}

/** Moyennes annuelles (années quasi complètes seulement, ≥ 360 jours valides). */
export function moyennesAnnuelles(time: string[], tmean: number[]): AnneeObservee[] {
  const acc = new Map<number, { s: number; n: number }>();
  time.forEach((t, i) => {
    const v = tmean[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    const y = Number(t.slice(0, 4));
    const a = acc.get(y) ?? { s: 0, n: 0 };
    a.s += v;
    a.n++;
    acc.set(y, a);
  });
  return [...acc]
    .filter(([, a]) => a.n >= 360)
    .map(([annee, a]) => ({ annee, t: a.s / a.n }))
    .sort((a, b) => a.annee - b.annee);
}

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
  const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

  const BASE_CHAUFF = 18;
  const BASE_CLIM = 18;
  let djuChauff = 0;
  let djuClim = 0;
  let nuitsTrop = 0;
  let jours30 = 0;
  let jours35 = 0;
  let vagues = 0;
  let run = 0;
  let sumMean = 0;
  let valid = 0;
  const validYears = new Set<string>();

  for (let i = 0; i < n; i++) {
    const tmin = daily.temperature_2m_min[i];
    const tmax = daily.temperature_2m_max[i];
    // Jours incomplets ignorés : une valeur manquante comptée 0 °C ferait
    // chuter la moyenne et gonfler les besoins de chauffage (constaté sur un
    // modèle de projection le 12/11/2026). Moyenne absente : (min + max) / 2.
    if (!ok(tmin) || !ok(tmax)) {
      run = 0;
      continue;
    }
    const tmeanRaw = daily.temperature_2m_mean[i];
    const tmean = ok(tmeanRaw) ? tmeanRaw : (tmin + tmax) / 2;
    valid++;
    sumMean += tmean;
    validYears.add(daily.time[i].slice(0, 4));

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

  // Années équivalentes de données valides (365,25 jours), pour des comptages
  // annuels justes même si une partie de la série manque.
  const years = valid > 0 ? valid / 365.25 : 1;

  return {
    years: validYears.size || 1,
    tMoyenneAnnuelle: round1(valid > 0 ? sumMean / valid : NaN),
    djuChauffage: Math.round(djuChauff / years),
    djuClim: Math.round(djuClim / years),
    nuitsTropicales: round1(nuitsTrop / years),
    joursChaleur30: round1(jours30 / years),
    joursChaleur35: round1(jours35 / years),
    vaguesChaleur: round1(vagues / years),
  };
}

const yearOf = (isoDate: string): number => Number(isoDate.slice(0, 4));

export function computeClimat(raw: ClimatRaw): Omit<ClimatResult, "projections" | "site"> {
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
    // Valeurs manquantes écartées (sinon comptées 0 °C dans la moyenne).
    if (Number.isFinite(d.temperature_2m_max[i])) tMaxByMonth[m].push(d.temperature_2m_max[i]);
    if (Number.isFinite(d.temperature_2m_min[i])) tMinByMonth[m].push(d.temperature_2m_min[i]);
    if (Number.isFinite(d.temperature_2m_mean[i])) tMeanByMonth[m].push(d.temperature_2m_mean[i]);
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

  return { monthly, ...indicators, nuitsParMois: nuitsTropicalesParMois(d).map(round1) };
}

// ---------------------------------------------------------------------------
// Projections climatiques (CMIP6, via Open-Meteo Climate API).
// ---------------------------------------------------------------------------

/** Fourchette entre modèles (valeurs projetées min et max). */
export interface Fourchette {
  min: number;
  max: number;
}

export interface ProjectionHorizon {
  id: string;
  label: string;
  /** Moyenne des modèles, après méthode des écarts. */
  indicators: TemperatureIndicators;
  /** Fourchette entre modèles pour les principaux indicateurs. */
  fourchette: {
    tMoyenneAnnuelle: Fourchette;
    nuitsTropicales: Fourchette;
    joursChaleur30: Fourchette;
    joursChaleur35: Fourchette;
    djuChauffage: Fourchette;
    djuClim: Fourchette;
  };
  /** Nuits tropicales par mois (méthode des écarts, moyenne des modèles). */
  nuitsParMois: number[];
  /** Nombre de modèles utilisés (ceux dont la référence 1991-2020 a répondu). */
  nbModeles: number;
  /** Écart absolu vs référence 1991-2020. */
  deltaTemp: number;
  deltaNuitsTropicales: number;
  deltaJours30: number;
  deltaVagues: number;
  /** Écart en %, null si la référence vaut 0 (pas de % significatif). */
  pctNuitsTropicales: number | null;
  pctJours30: number | null;
  pctVagues: number | null;
  pctDjuChauffage: number | null;
  pctDjuClim: number | null;
}

function pctChange(base: number, future: number): number | null {
  if (base <= 0) return null; // "apparition" d'un phénomène, pas un % exploitable
  return Math.round(((future - base) / base) * 1000) / 10;
}

type IndicKey = Exclude<keyof TemperatureIndicators, "years">;
const INDIC_KEYS: IndicKey[] = [
  "tMoyenneAnnuelle",
  "djuChauffage",
  "djuClim",
  "nuitsTropicales",
  "joursChaleur30",
  "joursChaleur35",
  "vaguesChaleur",
];

/**
 * Méthode des écarts : pour chaque modèle, écart = horizon − sa propre
 * référence 1991-2020 ; valeur projetée = observation ERA5 + écart (bornée à 0
 * pour les comptages). On moyenne ensuite les modèles et on garde leur
 * fourchette. Un modèle sans référence est écarté : sans elle, son biais se
 * confondrait avec le réchauffement.
 */
export function computeProjectionHorizon(
  id: string,
  label: string,
  perModel: ModelSeries[],
  baseline: TemperatureIndicators & { nuitsParMois: number[] },
): ProjectionHorizon {
  const complets = perModel.filter(
    (m): m is ModelSeries & { reference: DailyTemperatureBlock } => m.reference !== null,
  );
  // Même méthode des écarts, mois par mois.
  const parMoisModeles = complets.map((m) => {
    const fut = nuitsTropicalesParMois(m.future);
    const ref = nuitsTropicalesParMois(m.reference);
    return baseline.nuitsParMois.map((b, k) => Math.max(0, b + fut[k] - ref[k]));
  });
  const nuitsParMois = baseline.nuitsParMois.map((_, k) => round1(mean(parMoisModeles.map((v) => v[k]))));
  const projected: TemperatureIndicators[] = complets
    .map((m) => {
      const fut = computeTemperatureIndicators(m.future);
      const ref = computeTemperatureIndicators(m.reference);
      const out = { years: fut.years } as TemperatureIndicators;
      for (const k of INDIC_KEYS) {
        const v = baseline[k] + (fut[k] - ref[k]);
        out[k] = k === "tMoyenneAnnuelle" ? v : Math.max(0, v);
      }
      return out;
    });

  const avg = (k: IndicKey) => mean(projected.map((t) => t[k]));
  const range = (k: IndicKey, digits = 1): Fourchette => {
    const vals = projected.map((t) => t[k]);
    const r = (v: number) => (digits === 0 ? Math.round(v) : round1(v));
    return vals.length ? { min: r(Math.min(...vals)), max: r(Math.max(...vals)) } : { min: NaN, max: NaN };
  };

  const indicators: TemperatureIndicators = {
    years: projected[0]?.years ?? 0,
    tMoyenneAnnuelle: round1(avg("tMoyenneAnnuelle")),
    djuChauffage: Math.round(avg("djuChauffage")),
    djuClim: Math.round(avg("djuClim")),
    nuitsTropicales: round1(avg("nuitsTropicales")),
    joursChaleur30: round1(avg("joursChaleur30")),
    joursChaleur35: round1(avg("joursChaleur35")),
    vaguesChaleur: round1(avg("vaguesChaleur")),
  };

  return {
    id,
    label,
    indicators,
    fourchette: {
      tMoyenneAnnuelle: range("tMoyenneAnnuelle"),
      nuitsTropicales: range("nuitsTropicales"),
      joursChaleur30: range("joursChaleur30"),
      joursChaleur35: range("joursChaleur35"),
      djuChauffage: range("djuChauffage", 0),
      djuClim: range("djuClim", 0),
    },
    nuitsParMois,
    nbModeles: projected.length,
    deltaTemp: round1(indicators.tMoyenneAnnuelle - baseline.tMoyenneAnnuelle),
    deltaNuitsTropicales: round1(indicators.nuitsTropicales - baseline.nuitsTropicales),
    deltaJours30: round1(indicators.joursChaleur30 - baseline.joursChaleur30),
    deltaVagues: round1(indicators.vaguesChaleur - baseline.vaguesChaleur),
    pctNuitsTropicales: pctChange(baseline.nuitsTropicales, indicators.nuitsTropicales),
    pctJours30: pctChange(baseline.joursChaleur30, indicators.joursChaleur30),
    pctVagues: pctChange(baseline.vaguesChaleur, indicators.vaguesChaleur),
    pctDjuChauffage: pctChange(baseline.djuChauffage, indicators.djuChauffage),
    pctDjuClim: pctChange(baseline.djuClim, indicators.djuClim),
  };
}
