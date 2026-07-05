// Récupération de la vraie parcelle cadastrale (IGN Parcellaire Express /
// PCI, via Géoplateforme), pour remplacer l'approximation "bâtiment le plus
// proche" utilisée jusqu'ici pour le cadrage "Parcelle".
//
// Rappel important (documenté aussi dans le rapport) : le contour cadastral
// PCI est une représentation graphique, pas un document juridique — seuls les
// actes de vente font foi. Suffisant pour un diagnostic, pas pour borner un
// terrain.
import { fetchJson } from "../api/client";
import { ignWfsParcelles } from "../api/endpoints";
import { bboxAroundMeters, polygonAreaM2, pointInPolygon, centroid, distanceMeters } from "./geo";
import type { LatLon } from "./geo";

export interface Parcelle {
  polygon: LatLon[];
  /** Surface cadastrale officielle (m²) si l'attribut "contenance" est présent,
   *  sinon surface recalculée depuis la géométrie (moins fiable, indiqué). */
  surfaceM2: number;
  surfaceSource: "contenance" | "geometrie";
  /** Référence lisible, ex. "44109 EX 0068", null si les attributs manquent. */
  reference: string | null;
}

interface IgnParcelleFeature {
  geometry: { type: string; coordinates: number[][][] };
  properties: Record<string, unknown>;
}
interface IgnParcelleResponse {
  features: IgnParcelleFeature[];
}

const SEARCH_RADIUS_M = 60; // suffisant pour couvrir une parcelle depuis un point interne

function buildReference(props: Record<string, unknown>): string | null {
  const codeDep = props.code_dep;
  const codeCom = props.code_com;
  const section = props.section;
  const numero = props.numero;
  if ([codeDep, codeCom, section, numero].every((v) => v !== undefined && v !== null)) {
    return `${codeDep}${codeCom} ${section} ${String(numero).padStart(4, "0")}`;
  }
  return null;
}

function extractSurface(
  props: Record<string, unknown>,
  polygon: LatLon[],
): { surfaceM2: number; surfaceSource: "contenance" | "geometrie" } {
  const contenance = props.contenance;
  if (typeof contenance === "number" && contenance > 0) {
    return { surfaceM2: Math.round(contenance), surfaceSource: "contenance" };
  }
  return { surfaceM2: Math.round(polygonAreaM2(polygon)), surfaceSource: "geometrie" };
}

export async function fetchParcelle(lat: number, lon: number): Promise<Parcelle | null> {
  try {
    const bbox = bboxAroundMeters(lat, lon, SEARCH_RADIUS_M);
    const url = ignWfsParcelles(bbox);
    const data = await fetchJson<IgnParcelleResponse>(url, {
      cacheKey: "ign-wfs:parcelle",
      ttlMs: 180 * 24 * 60 * 60 * 1000, // le parcellaire évolue peu, cache long
      timeoutMs: 20_000,
      retries: 2,
    });

    const candidates = (data.features ?? [])
      .filter((f) => f.geometry?.type === "Polygon" && f.geometry.coordinates?.[0]?.length >= 3)
      .map((f) => ({
        polygon: f.geometry.coordinates[0].map(([lon2, lat2]) => ({ lat: lat2, lon: lon2 })),
        properties: f.properties,
      }));

    if (candidates.length === 0) return null;

    const site: LatLon = { lat, lon };
    const containing = candidates.find((c) => pointInPolygon(site, c.polygon));
    const picked =
      containing ??
      candidates.reduce((best, c) =>
        distanceMeters(centroid(c.polygon), site) < distanceMeters(centroid(best.polygon), site)
          ? c
          : best,
      );

    const { surfaceM2, surfaceSource } = extractSurface(picked.properties, picked.polygon);

    return {
      polygon: picked.polygon,
      surfaceM2,
      surfaceSource,
      reference: buildReference(picked.properties),
    };
  } catch {
    return null; // le cadastre reste une donnée d'agrément, jamais bloquante
  }
}
