// Construit le SiteContext partagé : géocodage BAN + altitude RGE ALTI + parcelle cadastrale.
import type { SiteContext } from "./types";
import { geocode, ensureInsee, type GeocodeResult } from "./geocode";
import { fetchJson, roundCoord } from "../api/client";
import { IGN_ALTI } from "../api/endpoints";
import { fetchParcelle } from "./cadastre";

interface IgnAltiResponse {
  // Avec zonly=true, le service renvoie des nombres bruts : {"elevations":[43.09]}
  // (vérifié le 11/11/2026) ; sans zonly, des objets {lat, lon, z}.
  elevations: (number | { z?: number })[];
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
    const first = data.elevations?.[0];
    const z = typeof first === "number" ? first : first?.z;
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
  /** Adresse déjà choisie dans les suggestions : évite un second géocodage. */
  preset?: GeocodeResult | null,
): Promise<SiteContext | null> {
  // Une suggestion issue du secours OSM n'a pas de code INSEE : on le complète.
  const geo = preset ? await ensureInsee(preset) : await geocode(query);
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
    geocodeSource: geo.source,
    timezone: guessTimezone(),
    radiusM,
    parcelle,
  };
}
