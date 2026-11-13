// Ombres portées des arbres au sol, pour une position du soleil donnée.
//
// Même gabarit que le volume 3D (gabaritArbre) : le houppier est approché par
// trois disques étagés (bas, milieu, haut), le tronc par un segment. Chaque
// disque est projeté au sol à l'opposé du soleil, d'une longueur
// hauteur / tan(hauteur du soleil) ; l'ombre est l'enveloppe convexe des
// projections. Sol plat. Pour un arbre sans dimensions dans OpenStreetMap,
// la taille est générique : l'ombre est indicative.

import type { ArbreOsm } from "../modules/soleil/fetch";
import { gabaritArbre } from "./arbres3d";
import { MAX_SHADOW_M } from "../map3d/shadows";

type P = [number, number];

/** Enveloppe convexe (chaîne monotone d'Andrew). */
function enveloppe(points: P[]): P[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const bas: P[] = [];
  for (const p of pts) {
    while (bas.length >= 2 && cross(bas[bas.length - 2], bas[bas.length - 1], p) <= 0) bas.pop();
    bas.push(p);
  }
  const haut: P[] = [];
  for (const p of pts.reverse()) {
    while (haut.length >= 2 && cross(haut[haut.length - 2], haut[haut.length - 1], p) <= 0) haut.pop();
    haut.push(p);
  }
  return [...bas.slice(0, -1), ...haut.slice(0, -1)];
}

export function ombresArbres(arbres: ArbreOsm[], azimutDeg: number, hauteurDeg: number): GeoJSON.FeatureCollection {
  if (hauteurDeg <= 0.5 || arbres.length === 0) return { type: "FeatureCollection", features: [] };
  const az = (azimutDeg * Math.PI) / 180;
  const k = 1 / Math.tan((hauteurDeg * Math.PI) / 180); // m d'ombre par m de hauteur
  // Direction de l'ombre (à l'opposé du soleil), en (est, nord).
  const dx = -Math.sin(az);
  const dy = -Math.cos(az);
  const lat0 = arbres[0].lat;
  const mLat = 110_540;
  const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const N = 14;

  const polygones: P[][][] = [];
  for (const a of arbres) {
    const g = gabaritArbre(a);
    const proj = (z: number): P => {
      const l = Math.min(z * k, MAX_SHADOW_M);
      return [dx * l, dy * l];
    };
    const disque = (z: number, r: number): P[] => {
      const [cx, cy] = proj(z);
      return Array.from({ length: N }, (_, i) => {
        const t = (i / N) * 2 * Math.PI;
        return [cx + Math.cos(t) * r, cy + Math.sin(t) * r] as P;
      });
    };
    const pts: P[] = g.resineux
      ? [...disque(g.fut, g.rayon), proj(g.h)]
      : [...disque(g.cy - g.sy * 0.7, g.rayon * 0.7), ...disque(g.cy, g.rayon), ...disque(g.cy + g.sy * 0.7, g.rayon * 0.7)];
    const toLL = ([x, y]: P): P => [a.lon + x / mLon, a.lat + y / mLat];
    const houppier = enveloppe(pts).map(toLL);
    polygones.push([[...houppier, houppier[0]]]);
    // Tronc : bande fine du pied au bas du houppier.
    const [ex, ey] = proj(g.resineux ? g.fut : g.cy - g.sy * 0.7);
    const w = 0.25;
    const tronc: P[] = [[-dy * w, dx * w], [dy * w, -dx * w], [ex + dy * w, ey - dx * w], [ex - dy * w, ey + dx * w]].map((p) => toLL(p as P));
    polygones.push([[...tronc, tronc[0]]]);
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: polygones } }],
  };
}
