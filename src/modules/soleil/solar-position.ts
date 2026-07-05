// Géométrie solaire pure (aucune API, aucune dépendance).
//
// Choix volontaire : tout est exprimé en TEMPS SOLAIRE VRAI (angle horaire),
// pas en heure civile. C'est l'usage classique des diagrammes de masques en
// architecture, et ça évite toute la mécanique fuseau horaire/heure d'été
// pour un gain de précision nul sur ce type de diagramme.
//
// Convention d'azimut : 0° = Nord, 90° = Est, 180° = Sud, 270° = Ouest
// (identique à la convention utilisée dans les modules Vent et Urbanisme).

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Jour de l'année (1-366) en UTC. */
export function dayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((day - start) / 86400000) + 1;
}

/** Déclinaison solaire (degrés) pour un jour de l'année donné (approximation Cooper/Spencer). */
export function declinationDeg(dayOfYear: number): number {
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  return toDeg(decl);
}

/** Élévation solaire (degrés) pour une latitude, déclinaison et angle horaire donnés. */
export function elevationDeg(latDeg: number, declDeg: number, haDeg: number): number {
  const lat = toRad(latDeg);
  const decl = toRad(declDeg);
  const ha = toRad(haDeg);
  const sinElev = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  return toDeg(Math.asin(Math.max(-1, Math.min(1, sinElev))));
}

/** Azimut solaire (degrés, 0=N, 90=E, convention horaire). */
export function azimuthDeg(
  latDeg: number,
  declDeg: number,
  haDeg: number,
  elevDeg: number,
): number {
  const lat = toRad(latDeg);
  const decl = toRad(declDeg);
  const elev = toRad(elevDeg);
  const cosAz =
    (Math.sin(decl) - Math.sin(lat) * Math.sin(elev)) / (Math.cos(lat) * Math.cos(elev));
  const az = toDeg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
  // Formule symétrique le matin/après-midi : l'angle horaire positif = après-midi.
  return haDeg > 0 ? 360 - az : az;
}

/**
 * Demi-durée du jour en angle horaire (degrés), pour lat/décl données.
 * Retourne 180 (jour polaire) ou 0 (nuit polaire) dans les cas extrêmes —
 * n'arrive pas aux latitudes françaises, gardé par prudence.
 */
export function sunriseHourAngleDeg(latDeg: number, declDeg: number): number {
  const lat = toRad(latDeg);
  const decl = toRad(declDeg);
  const cosH = -Math.tan(lat) * Math.tan(decl);
  if (cosH <= -1) return 180; // jour polaire
  if (cosH >= 1) return 0; // nuit polaire
  return toDeg(Math.acos(cosH));
}

/** Conversion angle horaire (degrés) -> heure solaire décimale (12h = midi solaire). */
export function hourAngleToSolarHour(haDeg: number): number {
  return 12 + haDeg / 15;
}

/** Position solaire (élévation, azimut) pour une date et un angle horaire donnés. */
export interface SolarPosition {
  elevationDeg: number;
  azimuthDeg: number;
}

export function solarPositionAtHourAngle(
  latDeg: number,
  dayOfYear: number,
  haDeg: number,
): SolarPosition {
  const decl = declinationDeg(dayOfYear);
  const elev = elevationDeg(latDeg, decl, haDeg);
  const az = azimuthDeg(latDeg, decl, haDeg, elev);
  return { elevationDeg: elev, azimuthDeg: az };
}

/** Jours représentatifs pour le diagramme solaire (solstices + équinoxes). */
export const REFERENCE_DAYS = [
  { label: "Solstice d'hiver (21 déc.)", dayOfYear: 355 },
  { label: "Équinoxes (20 mars / 22 sept.)", dayOfYear: 79 },
  { label: "Solstice d'été (21 juin)", dayOfYear: 172 },
];

/** Jour représentatif du 15 de chaque mois, pour les calculs mensuels (approximation documentée). */
export const MID_MONTH_DAYS = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
