// Géocodage : Base Adresse Nationale (Géoplateforme IGN) en priorité, avec
// secours automatique sur Photon (moteur d'adresses OpenStreetMap, CORS ouvert)
// quand le service IGN ne répond pas — panne observée le 11/11/2026
// (« The upstream server is timing out » pendant plusieurs heures, l'ancien
// api-adresse.data.gouv.fr redirigeant vers une page d'excuse).
// Photon ne fournit pas le code INSEE : il est complété par l'API Découpage
// administratif de l'État (geo.api.gouv.fr).

import { fetchJson } from "../api/client";
import { BAN_SEARCH, PHOTON_SEARCH, GEO_API_COMMUNES } from "../api/endpoints";

interface BanFeature {
  geometry: { coordinates: [number, number] }; // [lon, lat]
  properties: {
    label: string;
    citycode?: string;
    city?: string;
    postcode?: string;
    context?: string;
    /** housenumber | street | locality | municipality */
    type?: string;
  };
}
interface BanResponse {
  features: BanFeature[];
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    type?: string; // house | street | city | locality | district | …
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    locality?: string;
    district?: string;
    county?: string;
    state?: string;
    countrycode?: string;
  };
}

export type GeocodeSource = "ban" | "osm";

export interface GeocodeResult {
  lat: number;
  lon: number;
  label: string;
  insee?: string;
  commune?: string;
  postcode?: string;
  /** Département et région, ex. "61, Orne, Normandie". */
  context?: string;
  /** Précision du résultat : numéro, voie, lieu-dit ou commune. */
  kind?: string;
  /** Base Adresse Nationale, ou OpenStreetMap (secours). */
  source?: GeocodeSource;
}

function fromBan(f: BanFeature): GeocodeResult {
  const [lon, lat] = f.geometry.coordinates;
  return {
    lat,
    lon,
    label: f.properties.label,
    insee: f.properties.citycode,
    commune: f.properties.city,
    postcode: f.properties.postcode,
    context: f.properties.context,
    kind: f.properties.type,
    source: "ban",
  };
}

const PHOTON_KIND: Record<string, string> = {
  house: "housenumber",
  street: "street",
  locality: "locality",
  district: "locality",
  city: "municipality",
};

function fromPhoton(f: PhotonFeature): GeocodeResult {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const voie = p.street ?? (p.type === "street" ? p.name : undefined);
  const numVoie = [p.housenumber, voie].filter(Boolean).join(" ");
  const lieu = numVoie || (p.type !== "city" ? p.name : "") || "";
  const commune = [p.postcode, p.city ?? (p.type === "city" ? p.name : undefined)].filter(Boolean).join(" ");
  return {
    lat,
    lon,
    label: [lieu, commune].filter(Boolean).join(" ") || p.name || "Adresse",
    commune: p.city ?? (p.type === "city" ? p.name : undefined),
    postcode: p.postcode,
    context: [p.county, p.state].filter(Boolean).join(", ") || undefined,
    kind: p.type ? (PHOTON_KIND[p.type] ?? p.type) : undefined,
    source: "osm",
  };
}

// --- État du service IGN : en panne, on passe directement au secours ----------
const BAN_TIMEOUT_MS = 5000;
const BAN_COOLDOWN_MS = 2 * 60_000;
let banDownUntil = 0;
const banIsDown = () => Date.now() < banDownUntil;
const markBanDown = () => (banDownUntil = Date.now() + BAN_COOLDOWN_MS);

/** fetch JSON avec délai, en combinant un éventuel signal d'annulation externe. */
async function getJson<T>(url: string, timeoutMs: number, outer?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  outer?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

async function banSearch(q: string, limit: number, autocomplete: boolean, signal?: AbortSignal, near?: { lat: number; lon: number }) {
  let url = `${BAN_SEARCH}?q=${encodeURIComponent(q)}&limit=${limit}`;
  if (autocomplete) url += "&autocomplete=1";
  if (near) url += `&lat=${near.lat.toFixed(5)}&lon=${near.lon.toFixed(5)}`;
  const data = await getJson<BanResponse>(url, BAN_TIMEOUT_MS, signal);
  return (data.features ?? []).map(fromBan);
}

async function photonSearch(q: string, limit: number, signal?: AbortSignal, near?: { lat: number; lon: number }) {
  // Emprise de la métropole et de la Corse ; résultats hors France écartés.
  let url = `${PHOTON_SEARCH}?q=${encodeURIComponent(q)}&limit=${limit + 4}&lang=fr&bbox=-5.5,41.2,9.8,51.2`;
  if (near) url += `&lat=${near.lat.toFixed(5)}&lon=${near.lon.toFixed(5)}`;
  const data = await getJson<{ features?: PhotonFeature[] }>(url, 8000, signal);
  return (data.features ?? [])
    .filter((f) => !f.properties.countrycode || f.properties.countrycode.toUpperCase() === "FR")
    .slice(0, limit)
    .map(fromPhoton);
}

/** Code INSEE au point (arrondissement municipal à Paris, Lyon, Marseille, comme la BAN). */
async function inseeAt(lat: number, lon: number): Promise<{ code: string; nom: string } | null> {
  const base = `${GEO_API_COMMUNES}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&fields=code,nom`;
  for (const url of [`${base}&type=arrondissement-municipal`, base]) {
    try {
      const list = await getJson<{ code: string; nom: string }[]>(url, 6000);
      if (Array.isArray(list) && list[0]?.code) return list[0];
    } catch {
      /* on essaie la forme suivante */
    }
  }
  return null;
}

/** Complète un résultat de secours avec le code INSEE (utile au module Réglementaire). */
export async function ensureInsee(r: GeocodeResult): Promise<GeocodeResult> {
  if (r.insee) return r;
  const c = await inseeAt(r.lat, r.lon);
  return c ? { ...r, insee: c.code, commune: r.commune ?? c.nom } : r;
}

/**
 * Géocode une adresse : BAN, puis Photon si la BAN est en panne.
 * Lève une erreur seulement si les deux services échouent.
 */
export async function geocode(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!banIsDown()) {
    try {
      // Cache court : une adresse déjà trouvée ne redemande rien.
      const data = await fetchJson<BanResponse>(`${BAN_SEARCH}?q=${encodeURIComponent(q)}&limit=1`, {
        cacheKey: "ban:search",
        ttlMs: 7 * 24 * 60 * 60 * 1000,
        timeoutMs: BAN_TIMEOUT_MS,
        retries: 1,
      });
      const f = data.features?.[0];
      return f ? fromBan(f) : null;
    } catch {
      markBanDown();
    }
  }
  const [first] = await photonSearch(q, 1);
  return first ? ensureInsee(first) : null;
}

/** Nombre minimal de caractères avant de proposer des suggestions. */
export const SUGGEST_MIN_CHARS = 3;

/**
 * Suggestions pendant la saisie : BAN, ou Photon si la BAN ne répond pas.
 * Chaque frappe annule la requête précédente via `signal`.
 */
export async function suggestAddresses(
  query: string,
  signal: AbortSignal,
  near?: { lat: number; lon: number },
  limit = 6,
): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < SUGGEST_MIN_CHARS) return [];
  if (!banIsDown()) {
    try {
      return await banSearch(q, limit, true, signal, near);
    } catch (err) {
      if (signal.aborted) throw err; // frappe suivante : pas une panne
      markBanDown();
    }
  }
  return photonSearch(q, limit, signal, near);
}
