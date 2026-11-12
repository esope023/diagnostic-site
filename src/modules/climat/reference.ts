// Encarts « Le site parmi les villes françaises » (C.3) et « Analogue
// climatique 2050 » (C.4). Ils comparent le site à des villes de référence
// calculées à l'avance avec la même source et la même méthode (voir
// scripts/climat-reference) : fichier publié sur la branche « donnees ».

import { fetchJson } from "../../api/client";
import { CLIMAT_REFERENCE_URL } from "../../api/endpoints";
import type { ClimatResult, ProjectionHorizon } from "./compute";
import { fr } from "./fiche";

interface Indic {
  tMoyenneAnnuelle: number;
  djuChauffage: number;
  djuClim: number;
  nuitsTropicales: number;
  joursChaleur30: number;
}
interface Ville {
  nom: string;
  region: string;
  pays: string;
  lat: number;
  lon: number;
  actuel?: Indic;
  h2050?: Indic & { nbModeles: number };
}
interface Fichier {
  majLe: string;
  villes: Ville[];
}

const PAYS: Record<string, string> = {
  FR: "France", ES: "Espagne", PT: "Portugal", IT: "Italie", GR: "Grèce", TN: "Tunisie", DZ: "Algérie",
};
const MIN_CLASSEMENT = 10;
const MIN_ANALOGUE = 15;

export async function chargerReference(): Promise<Fichier | null> {
  try {
    const f = await fetchJson<Fichier>(CLIMAT_REFERENCE_URL, {
      cacheKey: "climat-reference",
      ttlMs: 24 * 60 * 60 * 1000,
      timeoutMs: 20_000,
      retries: 2,
    });
    return Array.isArray(f?.villes) ? f : null;
  } catch {
    return null;
  }
}

function horizon2050(r: ClimatResult): ProjectionHorizon | undefined {
  return r.projections.find((p) => p.id === "2050");
}

// --- C.3 : le site parmi les villes françaises ------------------------------------

type Mesure = "nuits" | "j30" | "temp";
const MESURES: Record<Mesure, { titre: string; unite: string; digits: number; site: (r: ClimatResult, h: ProjectionHorizon) => number; ville: (v: Ville) => number }> = {
  nuits: {
    titre: "Nuits tropicales",
    unite: " nuits",
    digits: 0,
    site: (_r, h) => h.deltaNuitsTropicales,
    ville: (v) => v.h2050!.nuitsTropicales - v.actuel!.nuitsTropicales,
  },
  j30: {
    titre: "Jours ≥ 30 °C",
    unite: " jours",
    digits: 0,
    site: (_r, h) => h.deltaJours30,
    ville: (v) => v.h2050!.joursChaleur30 - v.actuel!.joursChaleur30,
  },
  temp: {
    titre: "Température",
    unite: " °C",
    digits: 1,
    site: (_r, h) => h.deltaTemp,
    ville: (v) => v.h2050!.tMoyenneAnnuelle - v.actuel!.tMoyenneAnnuelle,
  },
};

/** « 1 nuit tropicale », « 54 nuits tropicales ». */
const nb = (v: number, un: string, plusieurs: string) => `${fr(v)} ${Math.round(v) >= 2 ? plusieurs : un}`;
const signe = (v: number, d: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fr(Math.abs(v), d)}`;

function classement(r: ClimatResult, h: ProjectionHorizon, villes: Ville[], m: Mesure): string {
  const def = MESURES[m];
  const pts = villes.map((v) => ({ nom: v.nom, region: v.region, val: def.ville(v) }));
  const site = def.site(r, h);
  const vals = [...pts.map((p) => p.val), site];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || 1;
  const W = 340;
  const H = 92;
  const m0 = 12;
  const x = (v: number) => m0 + ((W - 2 * m0) * (v - lo + pad)) / (hi - lo + 2 * pad);
  const yAxe = 52;

  const tri = [...pts].sort((a, b) => b.val - a.val);
  const max = tri[0];
  const min = tri[tri.length - 1];
  const rang = pts.filter((p) => p.val > site).length + 1;

  const points = pts
    .map(
      (p) => `<circle cx="${x(p.val)}" cy="${yAxe}" r="4.5" class="rk-ville"><title>${p.nom} (${p.region}) : ${signe(p.val, def.digits)}${def.unite}</title></circle>`,
    )
    .join("");
  const etiquette = (v: number, texte: string, cls: string, y: number) => {
    const xv = x(v);
    const anchor = xv < 60 ? "start" : xv > W - 60 ? "end" : "middle";
    return `<text x="${xv}" y="${y}" text-anchor="${anchor}" class="${cls}">${texte}</text>`;
  };
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="rk-svg" role="img" aria-label="Hausse d'ici 2050 : le site et ${pts.length} villes françaises">
    <line x1="${m0}" x2="${W - m0}" y1="${yAxe}" y2="${yAxe}" class="rk-axe"/>
    ${points}
    <circle cx="${x(site)}" cy="${yAxe}" r="6.5" class="rk-site"><title>Le site : ${signe(site, def.digits)}${def.unite}</title></circle>
    ${etiquette(site, `Le site : ${signe(site, def.digits)}`, "rk-lbl-site", yAxe - 16)}
    ${etiquette(min.val, `${min.nom} ${signe(min.val, def.digits)}`, "rk-lbl", yAxe + 28)}
    ${etiquette(max.val, `${max.nom} ${signe(max.val, def.digits)}`, "rk-lbl", yAxe + 28)}
  </svg>`;

  const egal = (a: number, b: number) => Math.abs(a - b) < (def.digits ? 0.05 : 0.5);
  const position =
    rang === 1 && egal(site, max.val)
      ? `au niveau de la plus forte hausse des villes de référence (${max.nom})`
      : rang === 1
      ? "plus forte hausse de toutes les villes de référence"
      : rang === pts.length + 1
        ? "plus faible hausse de toutes les villes de référence"
        : `${rang}<sup>e</sup> plus forte hausse sur ${pts.length + 1} (site compris)`;
  return `${svg}
    <p class="fiche-phrase">${def.titre}, hausse d'ici 2050 : <strong>${signe(site, def.digits)}${def.unite}</strong>
    au site, ${position}. Plus forte : ${max.nom} (${signe(max.val, def.digits)}) ; plus faible :
    ${min.nom} (${signe(min.val, def.digits)}).</p>`;
}

// --- C.4 : analogue climatique ---------------------------------------------------

const DIMS: (keyof Indic)[] = ["tMoyenneAnnuelle", "nuitsTropicales", "joursChaleur30", "djuChauffage"];

function ecartType(vals: number[]): number {
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
}

/** Ressemblance (0-100 %) entre un climat et ceux des villes, sur 4 indicateurs
 * ramenés à leur dispersion entre villes : 100 % = identique. */
function proches(cible: Indic, villes: Ville[]): { v: Ville; ressemblance: number }[] {
  const sd = Object.fromEntries(DIMS.map((k) => [k, ecartType(villes.map((v) => v.actuel![k]))])) as Record<keyof Indic, number>;
  return villes
    .map((v) => {
      const d = Math.sqrt(DIMS.reduce((a, k) => a + ((cible[k] - v.actuel![k]) / sd[k]) ** 2, 0) / DIMS.length);
      return { v, ressemblance: Math.round(100 * Math.exp(-d)) };
    })
    .sort((a, b) => b.ressemblance - a.ressemblance);
}

function analogue(r: ClimatResult, h: ProjectionHorizon, villes: Ville[]): string {
  const futur: Indic = {
    tMoyenneAnnuelle: h.indicators.tMoyenneAnnuelle,
    nuitsTropicales: h.indicators.nuitsTropicales,
    joursChaleur30: h.indicators.joursChaleur30,
    djuChauffage: h.indicators.djuChauffage,
    djuClim: h.indicators.djuClim,
  };
  const top = proches(futur, villes).slice(0, 3);
  const aujourdhui = proches(r, villes)[0];
  const lignes = top
    .map(
      ({ v, ressemblance }) => `<li>
        <span class="an-nom">${v.nom}<span class="an-pays">${v.pays === "FR" ? v.region : PAYS[v.pays] ?? v.pays}</span></span>
        <span class="an-detail">${fr(v.actuel!.tMoyenneAnnuelle, 1)} °C · ${nb(v.actuel!.nuitsTropicales, "nuit tropicale", "nuits tropicales")} · ${fr(v.actuel!.joursChaleur30)} j ≥ 30 °C</span>
        <span class="an-barre" aria-hidden="true"><span style="width:${ressemblance}%"></span></span>
        <span class="an-pct">${ressemblance} %</span>
      </li>`,
    )
    .join("");
  return `<p class="an-intro">En 2050, le climat du site ressemblera à celui qu'ont aujourd'hui :</p>
    <ol class="an-liste">${lignes}</ol>
    <p class="fiche-phrase">Repère : aujourd'hui, le site ressemble surtout à ${aujourdhui.v.nom}
    (${aujourdhui.ressemblance} %). Site en 2050 : ${fr(futur.tMoyenneAnnuelle, 1)} °C,
    ${nb(futur.nuitsTropicales, "nuit tropicale", "nuits tropicales")}, ${nb(futur.joursChaleur30, "jour", "jours")} ≥ 30 °C.</p>`;
}

// --- Assemblage -------------------------------------------------------------------

export function encartsReference(r: ClimatResult, f: Fichier | null): string {
  const h = horizon2050(r);
  if (!h) return "";
  if (!f) {
    return `<p class="module-note">Villes de référence indisponibles pour le moment — classement et
      analogue climatique non affichés (ce n'est pas une absence d'enjeu).</p>`;
  }
  const fr2050 = f.villes.filter((v) => v.pays === "FR" && v.actuel && v.h2050);
  const actuels = f.villes.filter((v) => v.actuel);
  const enCours = (n: number, total: number) =>
    `<p class="module-note">Calcul des villes de référence en cours (${n}/${total}) : l'encart apparaîtra
      quand assez de villes seront calculées.</p>`;
  const totalFr = f.villes.filter((v) => v.pays === "FR").length;

  const c3 =
    fr2050.length >= MIN_CLASSEMENT
      ? `<div class="rk" data-rk>
          <div class="segmented rk-choix" role="group" aria-label="Indicateur">
            ${(Object.keys(MESURES) as Mesure[])
              .map((k, i) => `<button type="button" data-mesure="${k}" aria-pressed="${i === 0}">${MESURES[k].titre}</button>`)
              .join("")}
          </div>
          <div data-rk-corps>${classement(r, h, fr2050, "nuits")}</div>
        </div>`
      : enCours(fr2050.length, totalFr);
  const c4 = actuels.length >= MIN_ANALOGUE ? analogue(r, h, actuels) : enCours(actuels.length, f.villes.length);

  return `<div class="encarts">
    <section class="encart">
      <h4>Le site parmi les villes françaises <span class="sub-note">hausse d'ici 2050 · ${fr2050.length} villes</span></h4>
      ${c3}
    </section>
    <section class="encart">
      <h4>Analogue climatique 2050 <span class="sub-note">${actuels.length} villes de France et d'Europe du Sud</span></h4>
      ${c4}
    </section>
  </div>
  <p class="module-note">Villes de référence calculées avec la même source et la même méthode que le site
  (ERA5 1991-2020 ; horizon 2050 par la méthode des écarts sur les mêmes 3 modèles). Ressemblance :
  température moyenne, nuits tropicales, jours ≥ 30 °C et besoins de chauffage, comparés à la dispersion
  entre villes ; 100 % = climats identiques. Mise à jour du jeu : ${new Date(f.majLe).toLocaleDateString("fr-FR")}.</p>`;
}

/** Bascule de l'indicateur du classement. */
export function brancherEncarts(el: HTMLElement, r: ClimatResult, f: Fichier | null): void {
  const h = horizon2050(r);
  const rk = el.querySelector<HTMLElement>("[data-rk]");
  if (!h || !f || !rk) return;
  const villes = f.villes.filter((v) => v.pays === "FR" && v.actuel && v.h2050);
  rk.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mesure]");
    if (!b) return;
    rk.querySelectorAll("button[data-mesure]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    rk.querySelector("[data-rk-corps]")!.innerHTML = classement(r, h, villes, b.dataset.mesure as Mesure);
  });
}
