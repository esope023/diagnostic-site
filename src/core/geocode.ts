// Géocodage via la Base Adresse Nationale (gratuit, CORS ouvert, France).
import { fetchJson } from "../api/client";
import { BAN_SEARCH } from "../api/endpoints";

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
}

function toResult(f: BanFeature): GeocodeResult {
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
  };
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const url = `${BAN_SEARCH}?q=${encodeURIComponent(query)}&limit=1`;
  const data = await fetchJson<BanResponse>(url, {
    cacheKey: "ban:search",
    ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 jours
  });
  const f = data.features[0];
  return f ? toResult(f) : null;
}

/** Nombre minimal de caractères avant de proposer des suggestions. En deçà,
 * le moteur renvoie trop de candidats (et peut répondre en 504). */
export const SUGGEST_MIN_CHARS = 3;

/**
 * Suggestions d'adresses pendant la saisie (autocomplétion BAN).
 * Pas de cache ni de retry : chaque frappe annule la requête précédente via
 * `signal`, et une suggestion manquée n'est pas une erreur.
 * `near` oriente les résultats vers une position (ex. centre de la carte).
 */
export async function suggestAddresses(
  query: string,
  signal: AbortSignal,
  near?: { lat: number; lon: number },
  limit = 6,
): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < SUGGEST_MIN_CHARS) return [];
  let url = `${BAN_SEARCH}?q=${encodeURIComponent(q)}&limit=${limit}&autocomplete=1`;
  if (near) url += `&lat=${near.lat.toFixed(5)}&lon=${near.lon.toFixed(5)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as BanResponse;
  return (data.features ?? []).map(toResult);
}
