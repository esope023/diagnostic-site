// Mise en forme des données réglementaires et de risques. Pur, sans I/O.
// Peu de "calcul" à proprement parler : ce module présente des faits
// administratifs plutôt qu'il ne les dérive — la transparence porte donc
// surtout sur "quelle source a répondu", pas sur des seuils numériques.
import type { ReglementaireRaw, RisqueSyntheseRaw, CatnatItem, SupItem } from "./fetch";

export interface RisqueFlag {
  code: string;
  libelle: string;
  famille: "naturel" | "technologique";
  /** Statut à l'adresse, ex. « Risque Existant - important », « Risque Inconnu ». */
  statutAdresse: string | null;
  /** Statut sur la commune. */
  statutCommune: string | null;
}

export interface ReglementaireResult {
  zonageLibelle: string | null;
  zonageType: string | null;
  isRnu: boolean | null;
  documentUrl: string | null;
  /** null = source indisponible (≠ aucune servitude). */
  supCount: number | null;
  supItems: SupItem[];
  rgaExposition: string | null;
  rgaCode: string | null;
  risquesPresents: RisqueFlag[];
  risquesDisponibles: boolean;
  /** Risques qualifiés « existant » ou « concerné » à l'adresse même. */
  risquesAdresseCount: number;
  /** null = source indisponible (≠ aucun arrêté). */
  catnatCount: number | null;
  catnatRecent: CatnatItem[];
  /** Rapport Géorisques complet pour l'adresse. */
  georisquesUrl: string | null;
  partialFailure: boolean;
}

/** Risques marqués « present » dans la synthèse Géorisques, avec leur statut
 * à l'adresse et sur la commune (les deux sont utiles : un risque peut exister
 * sur la commune et être « inconnu » à l'adresse, ce qui n'est pas une absence). */
function extractRisquesPresents(raw: RisqueSyntheseRaw | null): RisqueFlag[] {
  if (!raw) return [];
  const flags: RisqueFlag[] = [];
  const familles = [
    ["naturel", raw.risquesNaturels],
    ["technologique", raw.risquesTechnologiques],
  ] as const;
  for (const [famille, entries] of familles) {
    for (const [code, v] of Object.entries(entries ?? {})) {
      if (v?.present !== true) continue;
      flags.push({
        code,
        famille,
        libelle: v.libelle ?? code,
        statutAdresse: v.libelleStatutAdresse ?? null,
        statutCommune: v.libelleStatutCommune ?? null,
      });
    }
  }
  return flags;
}

/** « Risque Existant… » ou « Risque Concerne » (mais pas « non Concerne »). */
export function isExistantAdresse(statutAdresse: string | null): boolean {
  const t = statutAdresse ?? "";
  return /^Risque Existant/i.test(t) || /^Risque Concern/i.test(t);
}

/** "JJ/MM/AAAA" → valeur triable. */
function dateKey(d?: string): number {
  const m = d?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? Number(m[3] + m[2] + m[1]) : 0;
}

export function computeReglementaire(raw: ReglementaireRaw): ReglementaireResult {
  return {
    zonageLibelle: raw.zonage?.libelle ?? raw.zonage?.libelong ?? null,
    zonageType: raw.zonage?.typezone ?? null,
    isRnu: raw.isRnu,
    documentUrl: raw.documentUrl,
    supCount: raw.sup?.length ?? null,
    supItems: raw.sup ?? [],
    rgaExposition: raw.rga?.exposition ?? null,
    rgaCode: raw.rga?.codeExposition ?? null,
    risquesPresents: extractRisquesPresents(raw.risquesSynthese),
    risquesDisponibles: raw.risquesSynthese !== null,
    risquesAdresseCount: extractRisquesPresents(raw.risquesSynthese).filter((f) =>
      isExistantAdresse(f.statutAdresse),
    ).length,
    catnatCount: raw.catnat?.total ?? null,
    catnatRecent: [...(raw.catnat?.items ?? [])]
      .sort((a, b) => dateKey(b.date_debut_evt) - dateKey(a.date_debut_evt))
      .slice(0, 5),
    georisquesUrl: raw.risquesSynthese?.url ?? null,
    partialFailure: raw.partialFailure,
  };
}
