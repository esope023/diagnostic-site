// Utilitaires géométriques partagés (aire, point-dans-polygone, distance).
// Approximation équirectangulaire suffisante à l'échelle d'un bâtiment/îlot
// (erreur négligeable sur quelques centaines de mètres). Pas de dépendance
// externe (type turf) pour rester léger.
export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6371000;

/** Distance haversine en mètres. */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Aire d'un polygone (mètres carrés), via projection équirectangulaire locale. */
export function polygonAreaM2(coords: LatLon[]): number {
  if (coords.length < 3) return 0;
  const lat0 = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);

  const pts = coords.map((c) => ({
    x: c.lon * mPerDegLon,
    y: c.lat * mPerDegLat,
  }));

  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area / 2);
}

/** Centroïde approximatif (moyenne des sommets — suffisant pour du picking). */
export function centroid(coords: LatLon[]): LatLon {
  const lat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const lon = coords.reduce((s, c) => s + c.lon, 0) / coords.length;
  return { lat, lon };
}

/**
 * Azimut (0-180°, axe symétrique) du plus long côté d'un polygone.
 * Sert à estimer l'orientation dominante d'une emprise bâtie.
 * 0° = axe Nord-Sud, 90° = axe Est-Ouest.
 */
export function longestEdgeAzimuthDeg(coords: LatLon[]): number {
  if (coords.length < 2) return 0;
  const lat0 = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);

  let bestLen = -1;
  let bestAz = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const dx = (b.lon - a.lon) * mPerDegLon;
    const dy = (b.lat - a.lat) * mPerDegLat;
    const len = Math.hypot(dx, dy);
    if (len > bestLen) {
      bestLen = len;
      const azFull = (Math.atan2(dx, dy) * 180) / Math.PI; // 0=N, 90=E
      bestAz = ((azFull % 180) + 180) % 180; // axe symétrique 0-180°
    }
  }
  return bestAz;
}

/** Azimut initial (0-360°, depuis le Nord, sens horaire) de a vers b. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Rectangle englobant (degrés) autour d'un point, pour les requêtes WFS/BBOX. */
export function bboxAroundMeters(
  lat: number,
  lon: number,
  radiusM: number,
): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

/** Longueur d'une polyligne (mètres), somme des segments successifs. */
export function lineLengthM(coords: LatLon[]): number {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += distanceMeters(coords[i], coords[i + 1]);
  }
  return total;
}

/** Test point-dans-polygone (ray casting). Fonctionne en lat/lon (approx locale). */
export function pointInPolygon(point: LatLon, coords: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i].lon;
    const yi = coords[i].lat;
    const xj = coords[j].lon;
    const yj = coords[j].lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
