// Récupération : zonage PLU (API Carto GPU), lien vers le règlement, SUP,
// et risques (Géorisques). Chaque appel est indépendant (Promise.all sur des
// fonctions qui catchent elles-mêmes) : l'échec d'une source n'empêche pas
// d'afficher les autres.
import { fetchJson } from "../../api/client";
import {
  gpuZoneUrba,
  gpuMunicipality,
  gpuSup,
  georisquesRga,
  georisquesSynthese,
  georisquesCatnat,
} from "../../api/endpoints";
import type { SiteContext } from "../../core/types";

function sitePoint(ctx: SiteContext) {
  return { type: "Point", coordinates: [ctx.lon, ctx.lat] };
}

/**
 * Corrige un mojibake UTF-8 relu en Latin-1 (ex. "HÃ´tel" -> "Hôtel"),
 * constaté sur les libellés de l'endpoint SUP de l'API Carto (les autres
 * endpoints GPU renvoient un encodage correct). Sans effet si la chaîne est
 * déjà bien encodée : le round-trip échoue silencieusement et on garde
 * l'original plutôt que de risquer de la corrompre.
 */
function fixMojibake(s: string): string {
  if (!/[ÃÂ][\x80-\xBF]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

// --- Zonage PLU --------------------------------------------------------------
export interface ZonageFeatureProps {
  libelle?: string;
  typezone?: string;
  partition?: string;
  libelong?: string;
  /** URL du règlement écrit (souvent avec l'ancre de la page de la zone). */
  urlfic?: string | null;
  /** Date de validité du document (AAAAMMJJ). */
  datvalid?: string | null;
}
interface GpuFeatureCollection<P> {
  features: { properties: P }[];
}

async function fetchZonage(ctx: SiteContext): Promise<ZonageFeatureProps | null> {
  try {
    const url = gpuZoneUrba(sitePoint(ctx));
    const data = await fetchJson<GpuFeatureCollection<ZonageFeatureProps>>(url, {
      cacheKey: "gpu:zone-urba",
      ttlMs: 60 * 24 * 60 * 60 * 1000, // un PLU change rarement d'une visite à l'autre
      timeoutMs: 15_000,
      retries: 2,
    });
    return data.features[0]?.properties ?? null;
  } catch {
    return null;
  }
}

async function fetchIsRnu(ctx: SiteContext): Promise<boolean | null> {
  if (!ctx.insee) return null;
  try {
    const url = gpuMunicipality(ctx.insee);
    const data = await fetchJson<{ features: { properties: { is_rnu?: boolean } }[] }>(url, {
      cacheKey: "gpu:municipality",
      ttlMs: 60 * 24 * 60 * 60 * 1000,
      timeoutMs: 15_000,
      retries: 2,
    });
    return data.features[0]?.properties?.is_rnu ?? null;
  } catch {
    return null;
  }
}

/** Lien vers le règlement : fourni directement par API Carto (champ `urlfic`).
 * L'ancienne route /api/document/{partition}/details du GPU répond 404. */
function documentUrlFrom(zonage: ZonageFeatureProps | null): string | null {
  const u = zonage?.urlfic;
  return typeof u === "string" && /^https?:\/\//.test(u) ? u : null;
}

// --- Servitudes d'utilité publique -------------------------------------------
export interface SupItem {
  categorie: string | null;
  libelle: string | null;
  /** Nature de l'assiette, ex. « Périmètre des abords ». */
  typeAssiette: string | null;
  /** Identifiant d'assiette, pour dédoublonner. */
  id: string | null;
}

interface GpuSupProps {
  // Noms réels observés sur l'API (constatés à l'usage, pas documentés
  // clairement) : le code de catégorie est "suptype" (ex. "AC1"), le libellé
  // lisible "nomsuplitt" (repli sur "nomass", plus technique).
  suptype?: string;
  nomsuplitt?: string;
  nomass?: string;
  typeass?: string;
  idass?: string;
}

async function fetchSupLayer(
  ctx: SiteContext,
  layer: "assiette-sup-s" | "assiette-sup-l" | "assiette-sup-p",
): Promise<SupItem[] | null> {
  try {
    const url = gpuSup(layer, sitePoint(ctx));
    const data = await fetchJson<GpuFeatureCollection<GpuSupProps>>(
      url,
      { cacheKey: `gpu:${layer}`, ttlMs: 60 * 24 * 60 * 60 * 1000, timeoutMs: 15_000 },
    );
    return data.features.map((f) => {
      const libelle = f.properties.nomsuplitt ?? f.properties.nomass ?? null;
      return {
        categorie: f.properties.suptype?.toUpperCase() ?? null,
        libelle: libelle !== null ? fixMojibake(libelle) : null,
        typeAssiette: f.properties.typeass ? fixMojibake(f.properties.typeass) : null,
        id: f.properties.idass ?? null,
      };
    });
  } catch {
    return null; // échec ≠ « aucune servitude »
  }
}

/** null si aucune des trois couches n'a répondu. Doublons d'assiette retirés. */
async function fetchSup(ctx: SiteContext): Promise<SupItem[] | null> {
  const layers = await Promise.all([
    fetchSupLayer(ctx, "assiette-sup-s"),
    fetchSupLayer(ctx, "assiette-sup-l"),
    fetchSupLayer(ctx, "assiette-sup-p"),
  ]);
  if (layers.every((l) => l === null)) return null;
  const seen = new Set<string>();
  const items: SupItem[] = [];
  for (const item of layers.flatMap((l) => l ?? [])) {
    const key = item.id ?? `${item.categorie}|${item.libelle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

// --- Géorisques ----------------------------------------------------------------
export interface RgaResult {
  codeExposition: string;
  exposition: string;
}

async function fetchRga(ctx: SiteContext): Promise<RgaResult | null> {
  try {
    return await fetchJson<RgaResult>(georisquesRga(ctx.lat, ctx.lon), {
      cacheKey: "georisques:rga",
      ttlMs: 90 * 24 * 60 * 60 * 1000,
      timeoutMs: 15_000,
      retries: 1, // pas d'acharnement : cette API a des instabilités connues
    });
  } catch {
    return null;
  }
}

/** Réponse de /resultats_rapport_risque (vérifiée le 11/11/2026) : deux
 * familles, chacune un objet { cléRisque: { present, libelle, statuts } }. */
export interface RisqueSyntheseEntry {
  present?: boolean;
  libelle?: string;
  libelleStatutCommune?: string | null;
  libelleStatutAdresse?: string | null;
}
export interface RisqueSyntheseRaw {
  risquesNaturels?: Record<string, RisqueSyntheseEntry | undefined>;
  risquesTechnologiques?: Record<string, RisqueSyntheseEntry | undefined>;
  /** Lien vers le rapport Géorisques complet pour cette adresse. */
  url?: string;
}

async function fetchRisquesSynthese(ctx: SiteContext): Promise<RisqueSyntheseRaw | null> {
  try {
    return await fetchJson<RisqueSyntheseRaw>(georisquesSynthese(ctx.lat, ctx.lon), {
      cacheKey: "georisques:synthese",
      ttlMs: 30 * 24 * 60 * 60 * 1000,
      timeoutMs: 15_000,
      retries: 1,
    });
  } catch {
    return null; // module affichera "indisponible" plutôt qu'un plantage
  }
}

/** Champs réels de /gaspar/catnat (dates au format JJ/MM/AAAA). */
export interface CatnatItem {
  libelle_risque_jo?: string;
  date_debut_evt?: string;
  date_fin_evt?: string;
  date_publication_jo?: string;
  libelle_commune?: string;
}
export interface CatnatRaw {
  total: number;
  items: CatnatItem[];
}

/** null en cas d'échec : ne jamais l'afficher comme « aucun arrêté ». */
async function fetchCatnat(ctx: SiteContext): Promise<CatnatRaw | null> {
  try {
    const data = await fetchJson<{ results?: number; data?: CatnatItem[] | null }>(
      georisquesCatnat(ctx.lat, ctx.lon),
      { cacheKey: "georisques:catnat", ttlMs: 30 * 24 * 60 * 60 * 1000, timeoutMs: 15_000, retries: 1 },
    );
    if (!Array.isArray(data.data)) return null;
    return { total: data.results ?? data.data.length, items: data.data };
  } catch {
    return null;
  }
}

// --- Assemblage ----------------------------------------------------------------
export interface ReglementaireRaw {
  zonage: ZonageFeatureProps | null;
  isRnu: boolean | null;
  documentUrl: string | null;
  sup: SupItem[] | null;
  rga: RgaResult | null;
  risquesSynthese: RisqueSyntheseRaw | null;
  catnat: CatnatRaw | null;
  /** true si un souci technique a touché au moins une source (affiché, pas cause de blocage). */
  partialFailure: boolean;
}

export async function fetchReglementaire(ctx: SiteContext): Promise<ReglementaireRaw> {
  const [zonage, isRnu, sup, rga, risquesSynthese, catnat] = await Promise.all([
    fetchZonage(ctx),
    fetchIsRnu(ctx),
    fetchSup(ctx),
    fetchRga(ctx),
    fetchRisquesSynthese(ctx),
    fetchCatnat(ctx),
  ]);

  const documentUrl = documentUrlFrom(zonage);

  const partialFailure =
    zonage === null || rga === null || risquesSynthese === null || catnat === null || sup === null;

  return { zonage, isRnu, documentUrl, sup, rga, risquesSynthese, catnat, partialFailure };
}
