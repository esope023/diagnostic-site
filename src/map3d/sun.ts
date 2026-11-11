// Position du soleil à une date et une HEURE LÉGALE françaises (celle de la
// montre), pour la vue 3D. Le module Soleil raisonne en temps solaire vrai ;
// ici on convertit : heure légale → UTC → temps solaire vrai (longitude +
// équation du temps) → angle horaire → élévation / azimut.

import {
  dayOfYearUTC,
  declinationDeg,
  elevationDeg,
  azimuthDeg,
} from "../modules/soleil/solar-position";

/** Dernier dimanche d'un mois (jour du mois), en UTC. */
function lastSunday(year: number, month0: number): number {
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/**
 * Décalage de l'heure légale française métropolitaine sur UTC (heures) :
 * +2 de l'heure d'été (dernier dimanche de mars, 1 h UTC) à l'heure d'hiver
 * (dernier dimanche d'octobre, 1 h UTC), +1 sinon.
 */
export function franceUtcOffset(year: number, month0: number, day: number, legalHour: number): number {
  const startDay = lastSunday(year, 2);
  const endDay = lastSunday(year, 9);
  const t = Date.UTC(year, month0, day) + (legalHour - 1) * 3600_000; // ≈ instant UTC (hiver)
  const start = Date.UTC(year, 2, startDay, 1);
  const end = Date.UTC(year, 9, endDay, 1);
  return t >= start && t < end ? 2 : 1;
}

/** Équation du temps (minutes) — approximation NOAA, précision ~30 s. */
export function equationOfTimeMin(dayOfYear: number): number {
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  );
}

export interface SunAtLegalTime {
  elevationDeg: number;
  azimuthDeg: number;
  /** Heure solaire vraie correspondante (décimale). */
  solarHour: number;
  /** Décalage sur UTC retenu (1 = hiver, 2 = été). */
  utcOffset: number;
}

/**
 * @param isoDate "AAAA-MM-JJ"
 * @param legalHour heure légale décimale (14.5 = 14 h 30)
 */
export function sunAtLegalTime(lat: number, lon: number, isoDate: string, legalHour: number): SunAtLegalTime {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utcOffset = franceUtcOffset(y, m - 1, d, legalHour);
  const doy = dayOfYearUTC(new Date(Date.UTC(y, m - 1, d)));
  const utcHour = legalHour - utcOffset;
  const solarHour = utcHour + lon / 15 + equationOfTimeMin(doy) / 60;
  const ha = (solarHour - 12) * 15;
  const decl = declinationDeg(doy);
  const elev = elevationDeg(lat, decl, ha);
  return { elevationDeg: elev, azimuthDeg: azimuthDeg(lat, decl, ha, elev), solarHour, utcOffset };
}

/** "14.5" → "14 h 30". */
export function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh} h ${String(mm === 60 ? 0 : mm).padStart(2, "0")}`;
}
