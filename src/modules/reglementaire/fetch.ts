// Récupération : zonage PLU (API Carto GPU), lien vers le règlement, SUP,
// et risques (Géorisques). Chaque appel est indépendant (Promise.all sur des
// fonctions qui catchent elles-mêmes) : l'échec d'une source n'empêche pas
// d'afficher les autres.
import { fetchJson } from "../../api/client";
import {
  gpuZoneUrba,
  gpuMunicipality,
  gpuSup,
  gpuDocumentDetails,
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

async function fetchDocumentUrl(partition: string | undefined): Promise<string | null> {
  if (!partition) return null;
  try {
    const url = gpuDocumentDetails(partition);
    const data = await fetchJson<{ archiveUrl?: string; files?: { url: string; type?: string }[] }>(
      url,
      { cacheKey: "gpu:document-details", ttlMs: 60 * 24 * 60 * 60 * 1000, timeoutMs: 15_000 },
    );
    // Priorité à un fichier de règlement explicite, sinon l'archive complète.
    const reglement = data.files?.find((f) => (f.type ?? "").toLowerCase().includes("reglement"));
    return reglement?.url ?? data.archiveUrl ?? null;
  } catch {
    return null;
  }
}

// --- Servitudes d'utilité publique -------------------------------------------
export interface SupItem {
  categorie: string | null;
  libelle: string | null;
}

interface GpuSupProps {
  // Noms réels observés sur l'API (constatés à l'usage, pas documentés
  // clairement) : le code de catégorie est "suptype" (ex. "AC1"), le libellé
  // lisible "nomsuplitt" (repli sur "nomass", plus technique).
  suptype?: string;
  nomsuplitt?: string;
  nomass?: string;
}

async function fetchSupLayer(
  ctx: SiteContext,
  layer: "assiette-sup-s" | "assiette-sup-l" | "assiette-sup-p",
): Promise<SupItem[]> {
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
      };
    });
  } catch {
    return [];
  }
}

async function fetchSup(ctx: SiteContext): Promise<SupItem[]> {
  const [surf, lin, pct] = await Promise.all([
    fetchSupLayer(ctx, "assiette-sup-s"),
    fetchSupLayer(ctx, "assiette-sup-l"),
    fetchSupLayer(ctx, "assiette-sup-p"),
  ]);
  return [...surf, ...lin, ...pct];
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

/** Forme très défensive : la doc publique de cet endpoint est incomplète et son
 * comportement a été signalé instable par des utilisateurs tiers. On ne mise
 * rien sur sa structure au-delà de "certaines clés *peuvent* être présentes". */
export type RisqueSyntheseRaw = Record<
  string,
  { present?: boolean; libelle?: string } | undefined
>;

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

export interface CatnatItem {
  libelle?: string;
  dateDebut?: string;
  dateFin?: string;
}

async function fetchCatnat(ctx: SiteContext): Promise<CatnatItem[]> {
  try {
    const data = await fetchJson<{ data?: CatnatItem[] }>(georisquesCatnat(ctx.lat, ctx.lon), {
      cacheKey: "georisques:catnat",
      ttlMs: 30 * 24 * 60 * 60 * 1000,
      timeoutMs: 15_000,
      retries: 1,
    });
    return data.data ?? [];
  } catch {
    return [];
  }
}

// --- Assemblage ----------------------------------------------------------------
export interface ReglementaireRaw {
  zonage: ZonageFeatureProps | null;
  isRnu: boolean | null;
  documentUrl: string | null;
  sup: SupItem[];
  rga: RgaResult | null;
  risquesSynthese: RisqueSyntheseRaw | null;
  catnat: CatnatItem[];
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

  const documentUrl = await fetchDocumentUrl(zonage?.partition);

  const partialFailure = zonage === null || rga === null || risquesSynthese === null;

  return { zonage, isRnu, documentUrl, sup, rga, risquesSynthese, catnat, partialFailure };
}
