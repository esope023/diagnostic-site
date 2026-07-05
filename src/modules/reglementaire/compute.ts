// Mise en forme des données réglementaires et de risques. Pur, sans I/O.
// Peu de "calcul" à proprement parler : ce module présente des faits
// administratifs plutôt qu'il ne les dérive — la transparence porte donc
// surtout sur "quelle source a répondu", pas sur des seuils numériques.
import type { ReglementaireRaw, RisqueSyntheseRaw, CatnatItem, SupItem } from "./fetch";

export interface RisqueFlag {
  code: string;
  libelle: string;
}

export interface ReglementaireResult {
  zonageLibelle: string | null;
  zonageType: string | null;
  isRnu: boolean | null;
  documentUrl: string | null;
  supCount: number;
  supItems: SupItem[];
  rgaExposition: string | null;
  rgaCode: string | null;
  risquesPresents: RisqueFlag[];
  risquesDisponibles: boolean;
  catnatCount: number;
  catnatRecent: CatnatItem[];
  partialFailure: boolean;
}

/** Extraction défensive : on ne connaît pas la liste exhaustive des clés de
 * l'endpoint de synthèse, donc on ne filtre que sur la forme attendue
 * ({ present, libelle }) sans supposer quelles clés existent. */
function extractRisquesPresents(raw: RisqueSyntheseRaw | null): RisqueFlag[] {
  if (!raw) return [];
  const flags: RisqueFlag[] = [];
  for (const [code, value] of Object.entries(raw)) {
    if (value && value.present === true) {
      flags.push({ code, libelle: value.libelle ?? code });
    }
  }
  return flags;
}

export function computeReglementaire(raw: ReglementaireRaw): ReglementaireResult {
  return {
    zonageLibelle: raw.zonage?.libelle ?? raw.zonage?.libelong ?? null,
    zonageType: raw.zonage?.typezone ?? null,
    isRnu: raw.isRnu,
    documentUrl: raw.documentUrl,
    supCount: raw.sup.length,
    supItems: raw.sup,
    rgaExposition: raw.rga?.exposition ?? null,
    rgaCode: raw.rga?.codeExposition ?? null,
    risquesPresents: extractRisquesPresents(raw.risquesSynthese),
    risquesDisponibles: raw.risquesSynthese !== null,
    catnatCount: raw.catnat.length,
    catnatRecent: raw.catnat.slice(0, 5),
    partialFailure: raw.partialFailure,
  };
}
