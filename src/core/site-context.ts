// Construit le SiteContext partagé : géocodage BAN + altitude RGE ALTI + parcelle cadastrale.
import type { SiteContext } from "./types";
import { geocode } from "./geocode";
import { fetchJson, roundCoord } from "../api/client";
import { IGN_ALTI } from "../api/endpoints";
import { fetchParcelle } from "./cadastre";

interface IgnAltiResponse {
  elevations: { z: number }[] | { lat: number; lon: number; z: number }[];
}

async function fetchAltitude(lat: number, lon: number): Promise<number | null> {
  try {
    const url =
      `${IGN_ALTI}?lon=${lon}&lat=${lat}` +
      `&resource=ign_rge_alti_wld&zonly=true&indent=false`;
    const data = await fetchJson<IgnAltiResponse>(url, {
      cacheKey: "ign:alti",
      ttlMs: 365 * 24 * 60 * 60 * 1000, // le relief ne bouge pas
    });
    const first = data.elevations?.[0] as { z?: number } | undefined;
    const z = first?.z;
    // IGN renvoie -99999 hors couverture.
    return typeof z === "number" && z > -1000 ? z : null;
  } catch {
    return null;
  }
}

/** Détection simple du fuseau ; suffisant pour la France métropolitaine. */
function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris";
  } catch {
    return "Europe/Paris";
  }
}

export async function buildSiteContext(
  query: string,
  radiusM: number | null,
): Promise<SiteContext | null> {
  const geo = await geocode(query);
  if (!geo) return null;

  const [altitude, parcelle] = await Promise.all([
    fetchAltitude(roundCoord(geo.lat, 5), roundCoord(geo.lon, 5)),
    fetchParcelle(geo.lat, geo.lon),
  ]);

  return {
    lat: geo.lat,
    lon: geo.lon,
    altitude,
    label: geo.label,
    insee: geo.insee,
    commune: geo.commune,
    postcode: geo.postcode,
    timezone: guessTimezone(),
    radiusM,
    parcelle,
  };
}
