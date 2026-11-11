// Ombres portées des bâtiments sur un sol plat — calcul géométrique exact
// pour un prisme droit : l'ombre d'un bâtiment de hauteur h est la réunion de
// son emprise, de l'emprise translatée de L = h / tan(élévation) à l'opposé
// du soleil, et des quadrilatères balayés par chaque arête entre les deux.
// Pour une emprise convexe, c'est exactement l'enveloppe convexe des deux
// emprises (raccourci rapide, utilisé pour la grande majorité des bâtiments).
//
// Limites (affichées dans l'interface) : sol supposé plat (pas de relief),
// toitures plates à la hauteur BD TOPO, ombres portées sur les toits voisins
// non représentées, végétation ignorée.

import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";

/** Hauteur supposée quand la source n'en donne pas (même hypothèse que le module Soleil). */
export const DEFAULT_HEIGHT_M = 9;
/** Longueur d'ombre maximale (soleil rasant) : au-delà, l'ombre est tronquée. */
export const MAX_SHADOW_M = 400;

type XY = [number, number];

/** Bâtiment réduit à l'essentiel, transmissible au worker : anneau [lon, lat] + hauteur. */
export interface ShadowBuilding {
  ring: [number, number][];
  heightM: number | null;
}

const M_PER_DEG_LAT = 110_540;

/** Projection locale équirectangulaire autour du site (précision métrique à l'échelle d'un quartier). */
function projector(lat0: number, lon0: number) {
  const mPerDegLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toXY: ([lon, lat]: [number, number]): XY => [(lon - lon0) * mPerDegLon, (lat - lat0) * M_PER_DEG_LAT],
    toLonLat: ([x, y]: XY): [number, number] => [lon0 + x / mPerDegLon, lat0 + y / M_PER_DEG_LAT],
  };
}

const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Enveloppe convexe (chaîne monotone d'Andrew), anneau fermé. */
function convexHull(points: XY[]): XY[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const lower: XY[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  hull.push(hull[0]);
  return hull;
}

function isConvex(p: XY[]): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const c = cross(p[i], p[(i + 1) % p.length], p[(i + 2) % p.length]);
    if (Math.abs(c) < 1e-9) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

const closed = (r: XY[]): XY[] => [...r, r[0]];

/** Ombre d'un bâtiment, en mètres. */
function buildingShadow(ring: XY[], dx: number, dy: number): Polygon[] {
  const last = ring[ring.length - 1];
  const p = ring.length > 1 && ring[0][0] === last[0] && ring[0][1] === last[1] ? ring.slice(0, -1) : ring;
  if (p.length < 3) return [];
  const shifted = p.map(([x, y]) => [x + dx, y + dy] as XY);
  if (isConvex(p)) return [[convexHull([...p, ...shifted])]];
  const parts: Polygon[] = [[closed(p)], [closed(shifted)]];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    parts.push([closed([a, b, [b[0] + dx, b[1] + dy], [a[0] + dx, a[1] + dy]])]);
  }
  try {
    return polygonClipping.union(parts[0], ...parts.slice(1));
  } catch {
    return parts;
  }
}

/** Réunion par paquets (bien plus rapide qu'une réunion de tout d'un coup). */
function unionAll(polys: MultiPolygon[]): MultiPolygon {
  let layer = polys.filter((p) => p.length > 0);
  if (layer.length === 0) return [];
  while (layer.length > 1) {
    const next: MultiPolygon[] = [];
    for (let i = 0; i < layer.length; i += 16) {
      const chunk = layer.slice(i, i + 16);
      try {
        next.push(chunk.length === 1 ? chunk[0] : polygonClipping.union(chunk[0], ...chunk.slice(1)));
      } catch {
        next.push(chunk.flat()); // géométrie dégénérée : on garde sans réunir
      }
    }
    layer = next;
  }
  return layer[0];
}

export interface ShadowResult {
  /** Ombres réunies en [lon, lat] (GeoJSON MultiPolygon). */
  multiPolygon: MultiPolygon;
  /** Soleil sous l'horizon : aucune ombre. */
  night: boolean;
  /** Longueur d'ombre d'un bâtiment de 10 m (repère pédagogique). */
  lengthFor10m: number | null;
}

/**
 * @param sunElevationDeg élévation du soleil (degrés)
 * @param sunAzimuthDeg azimut du soleil (0 = N, 90 = E)
 */
export function computeShadows(
  buildings: ShadowBuilding[],
  lat0: number,
  lon0: number,
  sunElevationDeg: number,
  sunAzimuthDeg: number,
): ShadowResult {
  if (sunElevationDeg <= 0.5) return { multiPolygon: [], night: true, lengthFor10m: null };
  const { toXY, toLonLat } = projector(lat0, lon0);
  const tanElev = Math.tan((sunElevationDeg * Math.PI) / 180);
  const az = (sunAzimuthDeg * Math.PI) / 180;
  // L'ombre part à l'opposé du soleil : -(sin az, cos az) en (est, nord).
  const ux = -Math.sin(az);
  const uy = -Math.cos(az);

  const perBuilding: MultiPolygon[] = buildings.map((b) => {
    const len = Math.min((b.heightM ?? DEFAULT_HEIGHT_M) / tanElev, MAX_SHADOW_M);
    return buildingShadow(b.ring.map(toXY), ux * len, uy * len);
  });
  const merged = unionAll(perBuilding);
  return {
    multiPolygon: merged.map((poly) => poly.map((ring) => ring.map((pt) => toLonLat(pt as XY)))),
    night: false,
    lengthFor10m: Math.min(10 / tanElev, MAX_SHADOW_M),
  };
}
