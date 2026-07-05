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
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const url = `${BAN_SEARCH}?q=${encodeURIComponent(query)}&limit=1`;
  const data = await fetchJson<BanResponse>(url, {
    cacheKey: "ban:search",
    ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 jours
  });
  const f = data.features[0];
  if (!f) return null;
  const [lon, lat] = f.geometry.coordinates;
  return {
    lat,
    lon,
    label: f.properties.label,
    insee: f.properties.citycode,
    commune: f.properties.city,
    postcode: f.properties.postcode,
  };
}
