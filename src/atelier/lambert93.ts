// Lambert-93 (EPSG:2154) : projection conique conforme sécante de l'IGN,
// ellipsoïde GRS80. Sert au carroyage de l'atelier : des lignes à valeurs
// rondes en Lambert-93, comme sur un plan topographique français.
// Formules : IGN, « Projection cartographique conique conforme de Lambert »
// (notice NT/G 71), algorithmes ALG0001/ALG0002 et ALG0004.

const E = 0.0818191910428158; // excentricité GRS80
const N = 0.725607765053267;
const C = 11754255.426096;
const XS = 700000;
const YS = 12655612.049876;
const LON0 = (3 * Math.PI) / 180;

/** Latitude isométrique. */
function latIso(phi: number): number {
  return Math.log(Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi)), E / 2));
}

/** WGS84 (degrés) → Lambert-93 (mètres). */
export function versL93(lat: number, lon: number): [number, number] {
  const L = latIso((lat * Math.PI) / 180);
  const r = C * Math.exp(-N * L);
  const g = N * ((lon * Math.PI) / 180 - LON0);
  return [XS + r * Math.sin(g), YS - r * Math.cos(g)];
}

/** Lambert-93 (mètres) → WGS84 (degrés). */
export function depuisL93(x: number, y: number): [number, number] {
  const dx = x - XS;
  const dy = y - YS;
  const r = Math.sqrt(dx * dx + dy * dy);
  const g = Math.atan(dx / -dy);
  const lon = LON0 + g / N;
  const L = (-1 / N) * Math.log(Math.abs(r / C));
  let phi = 2 * Math.atan(Math.exp(L)) - Math.PI / 2;
  for (let i = 0; i < 12; i++) {
    const next = 2 * Math.atan(Math.pow((1 + E * Math.sin(phi)) / (1 - E * Math.sin(phi)), E / 2) * Math.exp(L)) - Math.PI / 2;
    if (Math.abs(next - phi) < 1e-12) break;
    phi = next;
  }
  return [(phi * 180) / Math.PI, (lon * 180) / Math.PI];
}

/**
 * Carroyage Lambert-93 autour d'un point : lignes aux multiples de `pas`
 * mètres, sur un carré de demi-côté `demi` mètres. Chaque ligne est
 * échantillonnée (elle n'est droite qu'en Lambert-93).
 */
export function carroyage(lat: number, lon: number, demi: number, pas: number): GeoJSON.FeatureCollection {
  const [x0, y0] = versL93(lat, lon);
  const xmin = Math.floor((x0 - demi) / pas) * pas;
  const xmax = Math.ceil((x0 + demi) / pas) * pas;
  const ymin = Math.floor((y0 - demi) / pas) * pas;
  const ymax = Math.ceil((y0 + demi) / pas) * pas;
  const n = 16;
  const ligne = (pts: [number, number][], valeur: number, axe: "x" | "y"): GeoJSON.Feature => ({
    type: "Feature",
    properties: { valeur, axe, majeur: valeur % (pas * 5) === 0 },
    geometry: { type: "LineString", coordinates: pts.map(([x, y]) => { const [la, lo] = depuisL93(x, y); return [lo, la]; }) },
  });
  const features: GeoJSON.Feature[] = [];
  for (let x = xmin; x <= xmax; x += pas) {
    features.push(ligne(Array.from({ length: n + 1 }, (_, i) => [x, ymin + ((ymax - ymin) * i) / n] as [number, number]), x, "x"));
  }
  for (let y = ymin; y <= ymax; y += pas) {
    features.push(ligne(Array.from({ length: n + 1 }, (_, i) => [xmin + ((xmax - xmin) * i) / n, y] as [number, number]), y, "y"));
  }
  return { type: "FeatureCollection", features };
}
