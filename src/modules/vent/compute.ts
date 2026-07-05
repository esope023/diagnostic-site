// Calculs vent : répartition par secteur (16 directions) et par saison,
// fréquence (%) et vitesse moyenne. Pur, sans I/O.
import type { VentRaw } from "./fetch";

export const SECTORS = 16;
const SECTOR_SIZE = 360 / SECTORS;

export const SECTOR_LABELS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export type Season = "hiver" | "printemps" | "ete" | "automne";
export const SEASONS: Season[] = ["hiver", "printemps", "ete", "automne"];
export const SEASON_LABELS: Record<Season, string> = {
  hiver: "Hiver (DJF)",
  printemps: "Printemps (MAM)",
  ete: "Été (JJA)",
  automne: "Automne (SON)",
};

function seasonOf(isoDate: string): Season {
  const month = Number(isoDate.slice(5, 7));
  if (month === 12 || month <= 2) return "hiver";
  if (month <= 5) return "printemps";
  if (month <= 8) return "ete";
  return "automne";
}

interface SectorBin {
  count: number;
  speedSum: number;
}

export interface SeasonRose {
  /** Fréquence (%) par secteur, somme = 100 (hors calme). */
  frequency: number[];
  /** Vitesse moyenne (m/s) par secteur. */
  meanSpeed: number[];
  /** Part de vent calme (< 0.5 m/s), en %. */
  calmPct: number;
  /** Secteur dominant (indice dans SECTOR_LABELS). */
  dominantSector: number;
  /** Vitesse moyenne toutes directions confondues (m/s). */
  meanSpeedOverall: number;
}

export interface VentResult {
  years: number;
  bySeason: Record<Season, SeasonRose>;
  annual: SeasonRose;
}

const CALM_THRESHOLD = 0.5; // m/s

function emptyBins(): SectorBin[] {
  return Array.from({ length: SECTORS }, () => ({ count: 0, speedSum: 0 }));
}

function toRose(bins: SectorBin[], calmCount: number, totalCount: number): SeasonRose {
  const validTotal = totalCount - calmCount;
  const frequency = bins.map((b) => (validTotal > 0 ? (b.count / validTotal) * 100 : 0));
  const meanSpeed = bins.map((b) => (b.count > 0 ? b.speedSum / b.count : 0));
  const dominantSector = frequency.reduce(
    (best, v, i) => (v > frequency[best] ? i : best),
    0,
  );
  const totalSpeedSum = bins.reduce((s, b) => s + b.speedSum, 0);
  return {
    frequency: frequency.map(round1),
    meanSpeed: meanSpeed.map(round1),
    calmPct: round1(totalCount > 0 ? (calmCount / totalCount) * 100 : 0),
    dominantSector,
    meanSpeedOverall: round1(validTotal > 0 ? totalSpeedSum / validTotal : 0),
  };
}

export function computeVent(raw: VentRaw): VentResult {
  const h = raw.hourly;
  const n = h.time.length;

  const bySeasonBins: Record<Season, SectorBin[]> = {
    hiver: emptyBins(),
    printemps: emptyBins(),
    ete: emptyBins(),
    automne: emptyBins(),
  };
  const bySeasonCalm: Record<Season, number> = { hiver: 0, printemps: 0, ete: 0, automne: 0 };
  const bySeasonTotal: Record<Season, number> = { hiver: 0, printemps: 0, ete: 0, automne: 0 };

  const annualBins = emptyBins();
  let annualCalm = 0;

  const years = new Set(h.time.map((t) => t.slice(0, 4))).size;

  for (let i = 0; i < n; i++) {
    const speed = h.windspeed_10m[i];
    const dir = h.winddirection_10m[i];
    if (speed == null || dir == null) continue;

    const season = seasonOf(h.time[i]);
    bySeasonTotal[season]++;

    if (speed < CALM_THRESHOLD) {
      bySeasonCalm[season]++;
      annualCalm++;
      continue;
    }

    const sector = Math.round(dir / SECTOR_SIZE) % SECTORS;
    bySeasonBins[season][sector].count++;
    bySeasonBins[season][sector].speedSum += speed;
    annualBins[sector].count++;
    annualBins[sector].speedSum += speed;
  }

  const bySeason = Object.fromEntries(
    SEASONS.map((s) => [
      s,
      toRose(bySeasonBins[s], bySeasonCalm[s], bySeasonTotal[s]),
    ]),
  ) as Record<Season, SeasonRose>;

  const annual = toRose(annualBins, annualCalm, n);

  return { years, bySeason, annual };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
