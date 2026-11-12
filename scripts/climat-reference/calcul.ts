// Calcul des valeurs de référence des villes (classement C.3, analogue C.4).
//
// Même source et même méthode que le module Climat du site :
//   - climat actuel : observations ERA5 1991-2020 (Open-Meteo archive) ;
//   - horizon 2050 (2036-2050) : méthode des écarts sur les 3 mêmes modèles
//     (écart de chaque modèle entre son 1991-2020 et 2036-2050, ajouté aux
//     observations), fourchette entre modèles.
// Les indicateurs sont calculés par computeTemperatureIndicators, la fonction
// même du site : un site et une ville de référence sont donc comparables.
//
// Le calcul avance par étapes et reprend là où il s'est arrêté : Open-Meteo
// compte une longue série comme de nombreux appels (quota horaire). Chaque
// passage s'arrête après BUDGET_MIN minutes ou quand le service refuse
// durablement, et enregistre ce qui est fait.
//
// Usage : npx tsx scripts/climat-reference/calcul.ts <fichier.json>

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { computeTemperatureIndicators, type DailyTemperatureBlock, type TemperatureIndicators } from "../../src/modules/climat/compute";
import { VILLES, type VilleReference } from "./villes";

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const CLIMATE = "https://climate-api.open-meteo.com/v1/climate";
const MODELES = ["EC_Earth3P_HR", "MRI_AGCM3_2_S", "CMCC_CM2_VHR4"];
const DAILY = "temperature_2m_max,temperature_2m_min,temperature_2m_mean";

const BUDGET_MS = Number(process.env.BUDGET_MIN ?? 50) * 60_000;
/** Pause entre deux requêtes lourdes, pour rester sous le quota par minute. */
const PAUSE_MS = Number(process.env.PAUSE_S ?? 75) * 1000;
const t0 = Date.now();

type Indic = Omit<TemperatureIndicators, "years">;
interface ParModele {
  fut: Indic;
  ref: Indic;
}
export interface VilleCalculee extends VilleReference {
  /** Climat actuel, ERA5 1991-2020. */
  actuel?: Indic;
  /** Écarts par modèle (étape intermédiaire, conservée pour la reprise). */
  modeles?: Record<string, ParModele>;
  /** Horizon 2050 (2036-2050), méthode des écarts, moyenne et fourchette. */
  h2050?: Indic & { nbModeles: number; fourchette: Record<"tMoyenneAnnuelle" | "nuitsTropicales" | "joursChaleur30", { min: number; max: number }> };
}
export interface FichierReference {
  version: 1;
  majLe: string;
  methode: string;
  villes: VilleCalculee[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(`${((Date.now() - t0) / 60000).toFixed(1)} min`, ...a);

class Quota extends Error {}

async function getDaily(url: string): Promise<DailyTemperatureBlock> {
  for (let essai = 1; essai <= 4; essai++) {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      log(`réseau (essai ${essai}) :`, (e as Error).message);
      if (essai === 4) throw new Quota("service injoignable");
      await sleep(30_000);
      continue;
    }
    if (res.ok) {
      const j = (await res.json()) as { daily?: DailyTemperatureBlock };
      if (!j.daily?.time?.length) throw new Error("réponse vide");
      return j.daily;
    }
    if (res.status === 429) {
      log(`refus 429 (essai ${essai}) :`, (await res.text()).slice(0, 160));
      if (essai === 4) throw new Quota("quota atteint");
      await sleep(60_000 * essai);
      continue;
    }
    if (res.status >= 500 && essai < 4) {
      await sleep(15_000);
      continue;
    }
    throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  throw new Error("inaccessible");
}

const sansAnnees = ({ years: _y, ...rest }: TemperatureIndicators): Indic => rest;

function agreger(actuel: Indic, modeles: ParModele[]): VilleCalculee["h2050"] {
  const cles = Object.keys(actuel) as (keyof Indic)[];
  const proj = modeles.map((m) => {
    const o = {} as Indic;
    for (const k of cles) {
      const v = actuel[k] + (m.fut[k] - m.ref[k]);
      o[k] = k === "tMoyenneAnnuelle" ? v : Math.max(0, v);
    }
    return o;
  });
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const moy = {} as Indic;
  for (const k of cles) moy[k] = r1(proj.reduce((a, p) => a + p[k], 0) / proj.length);
  const f = (k: keyof Indic) => ({ min: r1(Math.min(...proj.map((p) => p[k]))), max: r1(Math.max(...proj.map((p) => p[k]))) });
  return {
    ...moy,
    nbModeles: proj.length,
    fourchette: { tMoyenneAnnuelle: f("tMoyenneAnnuelle"), nuitsTropicales: f("nuitsTropicales"), joursChaleur30: f("joursChaleur30") },
  };
}

async function main(): Promise<void> {
  const chemin = process.argv[2];
  const precedent: Partial<FichierReference> = existsSync(chemin) ? JSON.parse(readFileSync(chemin, "utf8") || "{}") : {};
  const parNom = new Map((precedent.villes ?? []).map((v) => [v.nom, v]));
  const villes: VilleCalculee[] = VILLES.map((v) => ({ ...parNom.get(v.nom), ...v }));

  const enregistrer = () => {
    const out: FichierReference = {
      version: 1,
      majLe: new Date().toISOString(),
      methode:
        "ERA5 1991-2020 (Open-Meteo archive) ; horizon 2050 = 2036-2050, méthode des écarts sur EC-Earth3P-HR, " +
        "MRI-AGCM3-2-S et CMCC-CM2-VHR4 (Open-Meteo Climate API). Indicateurs identiques au module Climat du site.",
      villes,
    };
    writeFileSync(chemin, JSON.stringify(out, null, 1));
  };

  let requetes = 0;
  const requete = async (url: string) => {
    if (Date.now() - t0 > BUDGET_MS) throw new Quota("temps écoulé");
    if (requetes++ > 0) await sleep(PAUSE_MS);
    return getDaily(url);
  };

  try {
    for (const v of villes) {
      const ll = `latitude=${v.lat}&longitude=${v.lon}`;
      if (!v.actuel) {
        const d = await requete(`${ARCHIVE}?${ll}&start_date=1991-01-01&end_date=2020-12-31&daily=${DAILY}&timezone=auto`);
        v.actuel = sansAnnees(computeTemperatureIndicators(d));
        log(v.nom, "climat actuel", v.actuel.tMoyenneAnnuelle, "°C,", v.actuel.nuitsTropicales, "nuits");
        enregistrer();
      }
      // Projections : villes françaises seulement (classement) ; les villes
      // étrangères ne servent qu'à l'analogue, par leur climat actuel.
      if (v.pays !== "FR" || v.h2050) continue;
      v.modeles ??= {};
      for (const m of MODELES) {
        if (v.modeles[m]) continue;
        const base = `${CLIMATE}?${ll}&models=${m}&daily=${DAILY}`;
        const ref = await requete(`${base}&start_date=1991-01-01&end_date=2020-12-31`);
        const fut = await requete(`${base}&start_date=2036-01-01&end_date=2050-12-31`);
        v.modeles[m] = { ref: sansAnnees(computeTemperatureIndicators(ref)), fut: sansAnnees(computeTemperatureIndicators(fut)) };
        log(v.nom, m, "fait");
        enregistrer();
      }
      v.h2050 = agreger(v.actuel, Object.values(v.modeles));
      delete v.modeles;
      log(v.nom, "2050 :", v.h2050?.tMoyenneAnnuelle, "°C,", v.h2050?.nuitsTropicales, "nuits");
      enregistrer();
    }
    log("Toutes les villes sont calculées.");
  } catch (e) {
    if (e instanceof Quota) log("Arrêt de ce passage :", e.message, "— reprise au prochain passage.");
    else throw e;
  } finally {
    enregistrer();
    const faites = villes.filter((v) => v.actuel && (v.pays !== "FR" || v.h2050)).length;
    log(`Bilan : ${faites}/${villes.length} villes complètes, ${requetes} requêtes.`);
  }
}

void main();
