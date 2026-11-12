// Fiche graphique du climat futur : phrase-titre, chiffres clés « aujourd'hui
// → 2050 », trajectoires avec fourchette entre modèles, calendrier des nuits
// tropicales, bandes de réchauffement observé. SVG et HTML légers : ils
// suivent le thème clair / sombre par les variables CSS.

import type { ClimatResult, Fourchette, ProjectionHorizon, AnneeObservee } from "./compute";

const MOIS_COURT = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MOIS_LONG = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Nombre au format français (virgule décimale, espace des milliers). */
export function fr(v: number, digits = 0): string {
  return v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
const signe = (v: number, digits = 0) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fr(Math.abs(v), digits)}`;

function horizon2050(r: ClimatResult): ProjectionHorizon | undefined {
  return r.projections.find((p) => p.id === "2050") ?? r.projections[r.projections.length - 1];
}

// --- Phrase-titre ----------------------------------------------------------------

/**
 * Le « ×N » n'a de sens que si la référence est significative : passer de
 * 0,3 à 2 nuits tropicales ferait « ×7 » pour un enjeu faible (vu sur un site
 * frais le 12/11/2026). On prend donc le premier indicateur de chaleur dont la
 * référence atteint 5 jours par an ; sinon, l'écart de température moyenne.
 */
const SEUIL_REFERENCE = 5;

export function headline(r: ClimatResult): string {
  const h = horizon2050(r);
  if (!h) return "";
  const candidats = [
    {
      base: r.nuitsTropicales,
      fut: h.indicators.nuitsTropicales,
      f: h.fourchette.nuitsTropicales,
      nom: "nuits tropicales par an",
      unite: "nuits",
      pourquoi:
        "Une nuit tropicale ne descend pas sous 20 °C : le corps récupère mal et les bâtiments ne se déchargent pas de leur chaleur.",
    },
    {
      base: r.joursChaleur30,
      fut: h.indicators.joursChaleur30,
      f: h.fourchette.joursChaleur30,
      nom: "jours à 30 °C ou plus par an",
      unite: "jours",
      pourquoi: "Au-delà de 30 °C, l'inconfort d'été et les besoins de rafraîchissement augmentent nettement.",
    },
  ];
  const c = candidats.find((x) => x.base >= SEUIL_REFERENCE && x.fut / x.base >= 1.15);
  if (c) {
    const ratio = Math.round((c.fut / c.base) * 10) / 10;
    return `<div class="climat-headline">
      <span class="climat-facteur">×${fr(ratio, ratio % 1 === 0 ? 0 : 1)}</span>
      <div><p>À l'horizon 2050, environ <strong>${fr(c.fut)} ${c.nom}</strong>, contre ${fr(c.base)}
      sur 1991-2020.</p>
      <p class="climat-headline-sub">Fourchette des modèles : ${fr(c.f.min)} à ${fr(c.f.max)} ${c.unite}. ${c.pourquoi}</p></div>
    </div>`;
  }
  // Site frais : on met en avant l'écart de température et ses effets.
  const chauff = h.pctDjuChauffage;
  const clim = h.pctDjuClim;
  return `<div class="climat-headline">
    <span class="climat-facteur">${signe(h.deltaTemp, 1)} °C</span>
    <div><p>À l'horizon 2050, la température moyenne passe de <strong>${fr(r.tMoyenneAnnuelle, 1)}
    à ${fr(h.indicators.tMoyenneAnnuelle, 1)} °C</strong>.</p>
    <p class="climat-headline-sub">Fourchette des modèles : ${fr(h.fourchette.tMoyenneAnnuelle.min, 1)} à
    ${fr(h.fourchette.tMoyenneAnnuelle.max, 1)} °C.${
      chauff !== null ? ` Besoins de chauffage ${signe(chauff)} %` : ""
    }${clim !== null ? `, de rafraîchissement ${signe(clim)} %` : ""}. Les nuits tropicales restent rares
    (${fr(r.nuitsTropicales, 1)} → ${fr(h.indicators.nuitsTropicales, 1)} par an).</p></div>
  </div>`;
}

// --- Chiffres clés ---------------------------------------------------------------

function tuile(label: string, avant: string, apres: string, ecart: string, f?: Fourchette, digits = 0): string {
  const fourchette = f && Number.isFinite(f.min) && f.min !== f.max ? ` · ${fr(f.min, digits)}–${fr(f.max, digits)}` : "";
  return `<div class="cle">
    <span class="cle-label">${label}</span>
    <span class="cle-valeur">${avant} <span class="cle-fleche" aria-label="puis">→</span> ${apres}</span>
    <span class="cle-ecart">${ecart}${fourchette}</span>
  </div>`;
}

export function chiffresCles(r: ClimatResult): string {
  const h = horizon2050(r);
  if (!h) return "";
  const pct = (v: number | null) => (v === null ? "référence nulle" : `${signe(v)} %`);
  // Une décimale pour les petits comptages (0,6 → 3,5 plutôt que 1 → 4).
  const d = (a: number, b: number) => (Math.max(a, b) < 10 ? 1 : 0);
  const dn = d(r.nuitsTropicales, h.indicators.nuitsTropicales);
  const dj = d(r.joursChaleur30, h.indicators.joursChaleur30);
  return `<div class="cles" aria-label="Chiffres clés, 1991-2020 puis horizon 2050">
    ${tuile("Nuits tropicales / an", fr(r.nuitsTropicales, dn), fr(h.indicators.nuitsTropicales, dn), signe(h.deltaNuitsTropicales, dn), h.fourchette.nuitsTropicales, dn)}
    ${tuile("Jours ≥ 30 °C / an", fr(r.joursChaleur30, dj), fr(h.indicators.joursChaleur30, dj), signe(h.deltaJours30, dj), h.fourchette.joursChaleur30, dj)}
    ${tuile("Besoins de chauffage (DJU)", fr(r.djuChauffage), fr(h.indicators.djuChauffage), pct(h.pctDjuChauffage))}
    ${tuile("Besoins de rafraîchissement (DJU)", fr(r.djuClim), fr(h.indicators.djuClim), pct(h.pctDjuClim))}
  </div>`;
}

// --- Trajectoires (petits multiples) ----------------------------------------------

interface Point {
  label: string;
  v: number;
  min: number;
  max: number;
}

function trajectoire(titre: string, pts: Point[], unite: string, digits: number, depuisZero: boolean): string {
  const W = 250;
  const H = 170;
  const m = { l: 30, r: 16, t: 26, b: 24 };
  const lo0 = Math.min(...pts.map((p) => p.min));
  const hi0 = Math.max(...pts.map((p) => p.max));
  // Échelle : depuis 0 pour les comptages, resserrée pour une température.
  const pad = depuisZero ? 0 : Math.max(0.4, (hi0 - lo0) * 0.25);
  const lo = depuisZero ? 0 : Math.floor((lo0 - pad) * 2) / 2;
  const hiRaw = hi0 + (depuisZero ? hi0 * 0.15 : pad);
  const pas = niceStep((hiRaw - lo) / 4);
  const hi = Math.ceil(hiRaw / pas) * pas;
  const x = (i: number) => m.l + ((W - m.l - m.r) * (i + 0.5)) / pts.length;
  const y = (v: number) => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo || 1));

  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += pas) ticks.push(Math.round(v * 100) / 100);
  const grid = ticks
    .map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="t-grid"/>
      <text x="${m.l - 6}" y="${y(v) + 3.5}" class="t-axe" text-anchor="end">${fr(v, pas < 1 ? 1 : 0)}</text>`)
    .join("");
  const bande =
    `M${pts.map((p, i) => `${x(i)},${y(p.max)}`).join(" L")} ` +
    `L${[...pts].reverse().map((p, i) => `${x(pts.length - 1 - i)},${y(p.min)}`).join(" L")} Z`;
  const ligne = `M${pts.map((p, i) => `${x(i)},${y(p.v)}`).join(" L")}`;
  const points = pts
    .map((p, i) => {
      const f = p.min !== p.max ? ` (fourchette ${fr(p.min, digits)} à ${fr(p.max, digits)})` : "";
      return `<g class="t-pt"><title>${p.label} : ${fr(p.v, digits)}${unite}${f}</title>
        <circle cx="${x(i)}" cy="${y(p.v)}" r="12" class="t-hit"/>
        <circle cx="${x(i)}" cy="${y(p.v)}" r="4.5" class="t-dot"/>
        <text x="${x(i)}" y="${Math.max(12, y(p.max) - 7)}" class="t-val" text-anchor="middle">${fr(p.v, digits)}${unite}</text>
        <text x="${x(i)}" y="${H - 8}" class="t-axe" text-anchor="middle">${p.label}</text></g>`;
    })
    .join("");
  return `<figure class="traj">
    <figcaption>${titre}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${titre}">
      ${grid}<path d="${bande}" class="t-bande"/><path d="${ligne}" class="t-ligne"/>${points}
    </svg>
  </figure>`;
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const petit = (a: number, l: number[]) => (Math.max(a, ...l) < 10 ? 1 : 0);

export function trajectoires(r: ClimatResult): string {
  if (r.projections.length === 0) return "";
  const ref = (v: number): Point => ({ label: "1991-2020", v, min: v, max: v });
  const hz = (p: ProjectionHorizon, v: number, f: Fourchette): Point => ({ label: p.id, v, min: f.min, max: f.max });
  return `<div class="trajs">
    ${trajectoire("Nuits tropicales par an", [ref(r.nuitsTropicales), ...r.projections.map((p) => hz(p, p.indicators.nuitsTropicales, p.fourchette.nuitsTropicales))], "", petit(r.nuitsTropicales, r.projections.map((p) => p.indicators.nuitsTropicales)), true)}
    ${trajectoire("Jours à 30 °C ou plus par an", [ref(r.joursChaleur30), ...r.projections.map((p) => hz(p, p.indicators.joursChaleur30, p.fourchette.joursChaleur30))], "", petit(r.joursChaleur30, r.projections.map((p) => p.indicators.joursChaleur30)), true)}
    ${trajectoire("Température moyenne annuelle", [ref(r.tMoyenneAnnuelle), ...r.projections.map((p) => hz(p, p.indicators.tMoyenneAnnuelle, p.fourchette.tMoyenneAnnuelle))], " °C", 1, false)}
  </div>
  <p class="legende-traj"><span class="lg-ligne"></span>moyenne des ${r.projections[0].nbModeles} modèles
  <span class="lg-bande"></span>écart entre modèles</p>`;
}

// --- Calendrier des nuits tropicales ----------------------------------------------

/** Rampe séquentielle chaude (une teinte, clair → foncé). */
const RAMPE = ["#fde7d6", "#fbc9a3", "#f6a46f", "#ea7a43", "#cf5526", "#a63c14"];

function couleur(v: number, max: number): { bg: string; ink: string } {
  if (v < 0.5) return { bg: "var(--cal-vide)", ink: "transparent" };
  const k = Math.min(RAMPE.length - 1, Math.floor((v / Math.max(max, 1)) * RAMPE.length));
  return { bg: RAMPE[k], ink: k >= 3 ? "#ffffff" : "#3a1a08" };
}

function saison(vals: number[]): [number, number] | null {
  const mois = vals.map((v, i) => (v >= 0.5 ? i : -1)).filter((i) => i >= 0);
  return mois.length ? [mois[0], mois[mois.length - 1]] : null;
}
const nomSaison = (s: [number, number]) => (s[0] === s[1] ? MOIS_LONG[s[0]] : `${MOIS_LONG[s[0]]} – ${MOIS_LONG[s[1]]}`);

export function calendrier(r: ClimatResult): string {
  if (r.projections.length === 0) return "";
  const lignes = [
    { nom: "1991-2020", vals: r.nuitsParMois },
    ...r.projections.map((p) => ({ nom: p.id, vals: p.nuitsParMois })),
  ];
  const max = Math.max(...lignes.flatMap((l) => l.vals));
  const entete = `<span></span>${MOIS_COURT.map((m) => `<span class="cal-mois">${m}</span>`).join("")}`;
  const corps = lignes
    .map(
      (l) =>
        `<span class="cal-nom">${l.nom}</span>` +
        l.vals
          .map((v, i) => {
            const c = couleur(v, max);
            return `<span class="cal-case" style="background:${c.bg};color:${c.ink}" title="${l.nom}, ${MOIS_LONG[i]} : ${fr(v, 1)} nuit${v >= 2 ? "s" : ""} tropicale${v >= 2 ? "s" : ""} en moyenne">${v >= 0.5 ? fr(v) : ""}</span>`;
          })
          .join(""),
    )
    .join("");

  // Lecture en une phrase.
  const s0 = saison(r.nuitsParMois);
  const last = lignes[lignes.length - 1];
  const s1 = saison(last.vals);
  let phrase = "";
  if (!s1) {
    phrase = "Les nuits tropicales restent exceptionnelles sur ce site, aujourd'hui comme en 2050.";
  } else if (!s0) {
    phrase = `Quasi absentes aujourd'hui, elles apparaissent en ${nomSaison(s1)} à l'horizon ${last.nom}.`;
  } else {
    const etendue = s1[0] < s0[0] || s1[1] > s0[1];
    // Mois dont le nombre augmente le plus en proportion (parmi ceux déjà concernés).
    let best = -1;
    let ratio = 0;
    r.nuitsParMois.forEach((v, i) => {
      if (v >= 1 && last.vals[i] / v > ratio) {
        ratio = last.vals[i] / v;
        best = i;
      }
    });
    phrase = etendue
      ? `La saison des nuits tropicales s'étend de <strong>${nomSaison(s0)}</strong> à <strong>${nomSaison(s1)}</strong>.`
      : `La saison reste ${nomSaison(s0)}, mais chaque mois en compte davantage.`;
    if (best >= 0 && ratio >= 1.5) {
      phrase += ` En ${MOIS_LONG[best]}, leur nombre est multiplié par ${fr(ratio, ratio < 10 ? 1 : 0)} (${fr(r.nuitsParMois[best])} → ${fr(last.vals[best])}).`;
    }
  }
  return `<div class="cal" role="table" aria-label="Nuits tropicales par mois">${entete}${corps}</div>
    <p class="fiche-phrase">${phrase}</p>`;
}

// --- Bandes de réchauffement observé ---------------------------------------------

const BLEUS = ["#08306b", "#2166ac", "#4393c3", "#92c5de", "#d1e5f0"];
const ROUGES = ["#fddbc7", "#f4a582", "#d6604d", "#b2182b", "#67000d"];

function teinte(anomalie: number, amplitude: number): string {
  const k = Math.min(4, Math.floor((Math.abs(anomalie) / (amplitude || 1)) * 5));
  if (Math.abs(anomalie) < amplitude * 0.06) return "var(--strip-neutre)";
  return anomalie < 0 ? BLEUS[4 - k] : ROUGES[k];
}

export function bandes(obs: AnneeObservee[] | null | undefined): string {
  if (obs === undefined) return `<p class="placeholder">Chargement de la série 1950-2025…</p>`;
  if (!obs) {
    return `<p class="module-note">Série observée 1950-2025 indisponible pour le moment (service
      Open-Meteo) — ce n'est pas une absence de réchauffement. Réessayer plus tard.</p>`;
  }
  const ref = obs.filter((o) => o.annee >= 1971 && o.annee <= 2000);
  const tRef = ref.reduce((a, o) => a + o.t, 0) / (ref.length || 1);
  const amplitude = Math.max(...obs.map((o) => Math.abs(o.t - tRef)));
  const barres = obs
    .map((o) => {
      const a = o.t - tRef;
      return `<span style="background:${teinte(a, amplitude)}" title="${o.annee} : ${fr(o.t, 1)} °C (${signe(a, 1)} °C)"></span>`;
    })
    .join("");
  const premiere = obs[0].annee;
  const derniere = obs[obs.length - 1].annee;
  const reperes = [premiere, 1970, 1990, 2010, derniere].filter((a, i, t) => a >= premiere && a <= derniere && t.indexOf(a) === i);
  const pos = (a: number) => ((a - premiere + 0.5) / obs.length) * 100;
  const axe = reperes
    .map((a) => `<span style="left:${pos(a)}%">${a}</span>`)
    .join("");

  const chaudes = [...obs].sort((a, b) => b.t - a.t).slice(0, 6);
  const depuis = Math.min(...chaudes.map((o) => o.annee));
  const debut = obs.slice(0, 30);
  const fin = obs.slice(-30);
  const moy = (l: AnneeObservee[]) => l.reduce((a, o) => a + o.t, 0) / l.length;
  const gain = moy(fin) - moy(debut);
  return `<div class="stripes" role="img" aria-label="Températures annuelles ${premiere}-${derniere}">${barres}</div>
    <div class="stripes-axe">${axe}</div>
    <p class="fiche-phrase">Une bande par année ; bleu : plus frais que la moyenne 1971-2000
    (${fr(tRef, 1)} °C), rouge : plus chaud. Les six années les plus chaudes sont toutes postérieures
    à ${depuis - 1}. Entre ${debut[0].annee}-${debut[debut.length - 1].annee} et
    ${fin[0].annee}-${fin[fin.length - 1].annee}, le site s'est réchauffé de <strong>${signe(gain, 1)} °C</strong>.</p>`;
}
