// Mise en page et export de l'Atelier cartographique.
//
// Un cadre posé sur la carte montre l'emprise exacte de la feuille au sol,
// pour le format et l'échelle choisis (échelle saisie librement). L'export
// redessine la carte à la résolution d'impression dans une carte hors écran,
// par morceaux pour les grands formats (les navigateurs limitent la taille
// d'une image), puis compose la planche : PDF (habillage vectoriel : nord,
// échelle graphique, légende, cartouche, sources) ou PNG.
//
// Vue imprimée : nord en haut, sans inclinaison (2D) ; les arbres y sont des
// points.

import maplibregl from "maplibre-gl";
import { jsPDF } from "jspdf";

const MERC = 40075016.686; // circonférence équatoriale (m), Web Mercator
const TUILE = 2048; // côté d'un morceau rendu hors écran (px)
const PNG_MAX_PX = 16_000_000; // limite d'image de Safari iOS (~16,7 Mpx)

export const FORMATS = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  A0: [841, 1189],
} as const;
type NomFormat = keyof typeof FORMATS | "libre";

export interface ElementLegende {
  titre: string;
  source: string;
  /** Pastilles de couleur (bâtiments par hauteur, par usage…). */
  pastilles?: { couleur: string; libelle: string }[];
}

export interface OptionsMiseEnPage {
  map: maplibregl.Map;
  /** Conteneur de la carte, où placer le bouton et le panneau. */
  carte: HTMLElement;
  legende(): ElementLegende[];
  site(): { label: string } | null;
  /** Bascule la vue en 2D (la planche est imprimée nord en haut, à plat). */
  passer2D(): void;
}

interface Reglages {
  format: NomFormat;
  libre: [number, number];
  paysage: boolean;
  echelle: number;
  dpi: number;
  titre: string;
}

/** Géométrie de la planche (mm) : page, marges, bandeau, zone carte. */
function gabarit(r: Reglages) {
  const [a, b] = r.format === "libre" ? r.libre : FORMATS[r.format];
  const [w, h] = r.paysage ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
  const court = Math.min(w, h);
  const marge = Math.max(8, Math.round(court * 0.04));
  // Bandeau proportionnel au facteur de taille des textes (f = 1 en A4).
  const f = Math.max(1, court / 210);
  const bandeau = Math.round(36 * f);
  return { w, h, marge, bandeau, carteW: w - 2 * marge, carteH: h - 2 * marge - bandeau - marge / 2 };
}

const ll2merc = (lon: number, lat: number): [number, number] => [
  (lon * MERC) / 360,
  (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * MERC) / (2 * Math.PI),
];
const merc2ll = (x: number, y: number): [number, number] => [
  (x * 360) / MERC,
  (Math.atan(Math.exp((y * 2 * Math.PI) / MERC)) * 360) / Math.PI - 90,
];

/** Emprise au sol de la zone carte, en mètres Mercator, centrée sur `centre`. */
function emprise(r: Reglages, centre: maplibregl.LngLat) {
  const g = gabarit(r);
  const k = 1 / Math.cos((centre.lat * Math.PI) / 180); // dilatation Mercator
  const [cx, cy] = ll2merc(centre.lng, centre.lat);
  const larg = ((g.carteW * r.echelle) / 1000) * k;
  const haut = ((g.carteH * r.echelle) / 1000) * k;
  return { cx, cy, larg, haut, solW: (g.carteW * r.echelle) / 1000, solH: (g.carteH * r.echelle) / 1000 };
}

function polygoneCadre(r: Reglages, centre: maplibregl.LngLat): GeoJSON.FeatureCollection {
  const e = emprise(r, centre);
  const coin = (dx: number, dy: number) => merc2ll(e.cx + (dx * e.larg) / 2, e.cy + (dy * e.haut) / 2);
  const cadre = [coin(-1, -1), coin(1, -1), coin(1, 1), coin(-1, 1), coin(-1, -1)];
  // Voile hors cadre : quatre bandes autour (plus sûr qu'un polygone troué).
  const [ouest, sud] = coin(-1, -1);
  const [est, nord] = coin(1, 1);
  const W = ouest - 0.5, E = est + 0.5, S = sud - 0.3, N = nord + 0.3;
  const rect = (x1: number, y1: number, x2: number, y2: number): GeoJSON.Feature => ({
    type: "Feature",
    properties: { role: "masque" },
    geometry: { type: "Polygon", coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]] },
  });
  return {
    type: "FeatureCollection",
    features: [
      rect(W, nord, E, N), rect(W, S, E, sud), rect(W, sud, ouest, nord), rect(est, sud, E, nord),
      { type: "Feature", properties: { role: "cadre" }, geometry: { type: "LineString", coordinates: cadre } },
    ],
  };
}

/** Longueur « ronde » de l'échelle graphique (m) pour environ `cible` mètres. */
function longueurRonde(cible: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(cible)));
  for (const f of [5, 2, 1]) if (f * p <= cible) return f * p;
  return p;
}

/** Rend la carte à l'emprise demandée, morceau par morceau. */
async function rendre(
  map: maplibregl.Map,
  r: Reglages,
  centre: maplibregl.LngLat,
  pxW: number,
  pxH: number,
  surMorceau: (img: HTMLCanvasElement, x: number, y: number) => void,
  progres: (fait: number, total: number) => void,
): Promise<void> {
  const e = emprise(r, centre);
  const mppMerc = e.larg / pxW;
  const zoom = Math.log2(MERC / (512 * mppMerc));
  const style = map.getStyle();
  style.layers = style.layers.filter((l) => (l.type as string) !== "custom" && !l.id.startsWith("cadre-"));
  delete (style.sources as Record<string, unknown>)["cadre"];

  const div = document.createElement("div");
  div.style.cssText = `position:fixed;left:-${TUILE * 2}px;top:0;width:${TUILE}px;height:${TUILE}px;pointer-events:none;`;
  document.body.appendChild(div);
  const hors = new maplibregl.Map({
    container: div,
    style,
    center: centre,
    zoom,
    pitch: 0,
    bearing: 0,
    interactive: false,
    attributionControl: false,
    pixelRatio: 1,
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  try {
    await new Promise<void>((ok) => hors.once("load", () => ok()));
    const nx = Math.ceil(pxW / TUILE);
    const ny = Math.ceil(pxH / TUILE);
    let fait = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // Centre du morceau en Mercator (y Mercator vers le nord, image vers le bas).
        const px = i * TUILE + TUILE / 2;
        const py = j * TUILE + TUILE / 2;
        const mx = e.cx - e.larg / 2 + px * mppMerc;
        const my = e.cy + e.haut / 2 - py * mppMerc;
        hors.jumpTo({ center: merc2ll(mx, my), zoom });
        await new Promise<void>((ok) => {
          const t = setTimeout(ok, 20_000); // ne bloque pas sur une tuile perdue
          hors.once("idle", () => {
            clearTimeout(t);
            ok();
          });
          hors.triggerRepaint();
        });
        const c = document.createElement("canvas");
        c.width = Math.min(TUILE, pxW - i * TUILE);
        c.height = Math.min(TUILE, pxH - j * TUILE);
        c.getContext("2d")!.drawImage(hors.getCanvas(), 0, 0, c.width, c.height, 0, 0, c.width, c.height);
        surMorceau(c, i * TUILE, j * TUILE);
        progres(++fait, nx * ny);
      }
    }
  } finally {
    hors.remove();
    div.remove();
  }
}

// --- Habillage PDF (vectoriel) -------------------------------------------------------

function habillagePdf(doc: jsPDF, r: Reglages, g: ReturnType<typeof gabarit>, solW: number, legende: ElementLegende[], site: string): void {
  const x0 = g.marge;
  const y0 = g.marge;
  const f = Math.max(1, Math.min(g.w, g.h) / 210); // facteur de taille des textes
  doc.setDrawColor(40);
  doc.setLineWidth(0.3 * f);
  doc.rect(x0, y0, g.carteW, g.carteH);

  // Nord (haut droit de la carte)
  const nx = x0 + g.carteW - 10 * f;
  const ny = y0 + 6 * f;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(nx - 5 * f, ny - 2 * f, 10 * f, 15 * f, 1.5 * f, 1.5 * f, "F");
  doc.setFillColor(29, 29, 31);
  doc.triangle(nx, ny, nx - 3 * f, ny + 9 * f, nx, ny + 7 * f, "F");
  doc.setFillColor(170, 170, 175);
  doc.triangle(nx, ny, nx + 3 * f, ny + 9 * f, nx, ny + 7 * f, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7 * f);
  doc.setTextColor(29, 29, 31);
  doc.text("N", nx, ny + 12.5 * f, { align: "center" });

  // Échelle graphique (bas gauche de la carte)
  const mParMm = r.echelle / 1000;
  const L = longueurRonde((g.carteW * 0.22) * mParMm);
  const lmm = L / mParMm;
  const sx = x0 + 5 * f;
  const sy = y0 + g.carteH - 7 * f;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(sx - 2.5 * f, sy - 6 * f, lmm + 5 * f + 18 * f, 10 * f, 1.5 * f, 1.5 * f, "F");
  for (let k = 0; k < 4; k++) {
    if (k % 2 === 0) doc.setFillColor(29, 29, 31);
    else doc.setFillColor(255, 255, 255);
    doc.rect(sx + (k * lmm) / 4, sy - 1.2 * f, lmm / 4, 1.6 * f, "FD");
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5 * f);
  doc.text("0", sx, sy - 2.2 * f, { align: "center" });
  doc.text(`${L >= 1000 ? `${L / 1000} km` : `${L} m`}`, sx + lmm, sy - 2.2 * f, { align: "center" });
  doc.text(`1/${r.echelle.toLocaleString("fr-FR").replace(/ | /g, " ")}`, sx + lmm + 4 * f, sy + 0.4 * f);

  // Bandeau : cartouche à gauche, légende à droite
  const by = y0 + g.carteH + g.marge / 2;
  const bh = g.bandeau;
  doc.setLineWidth(0.2 * f);
  doc.line(x0, by, x0 + g.carteW, by);
  const colCart = g.carteW * 0.42;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11 * f);
  doc.text(doc.splitTextToSize(r.titre || "Plan", colCart - 4 * f).slice(0, 2), x0, by + 7 * f);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5 * f);
  doc.setTextColor(72, 72, 77);
  const nomFormat = r.format === "libre" ? `${g.w} × ${g.h} mm` : `${r.format} ${r.paysage ? "paysage" : "portrait"}`;
  const lignes = [
    site,
    `Échelle 1/${r.echelle} · ${nomFormat} · emprise ${Math.round(solW)} m de large`,
    `Édité le ${new Date().toLocaleDateString("fr-FR")} · Lambert-93 / Web Mercator, nord en haut`,
  ].filter(Boolean);
  doc.text(lignes.flatMap((l) => doc.splitTextToSize(l, colCart - 4 * f)), x0, by + 15 * f, { lineHeightFactor: 1.35 });
  doc.setFontSize(5.8 * f);
  doc.setTextColor(110, 110, 115);
  const sources = `Sources : ${[...new Set(legende.map((l) => l.source))].join(" · ")}. Diagnostic de site, données ouvertes.`;
  doc.text(doc.splitTextToSize(sources, colCart - 4 * f).slice(0, 2), x0, by + bh - 5 * f);

  // Légende en colonnes
  const lx0 = x0 + colCart + 4 * f;
  const lw = g.carteW - colCart - 4 * f;
  const nCol = lw > 160 * f ? 3 : 2;
  const cw = lw / nCol;
  let col = 0;
  let ly = by + 6 * f;
  const pas = 4 * f;
  doc.setTextColor(29, 29, 31);
  for (const el of legende) {
    const hauteur = pas * (1 + (el.pastilles ? Math.ceil(el.pastilles.length / 2) : 0));
    if (ly + hauteur > by + bh - 2 * f) {
      col++;
      ly = by + 6 * f;
      if (col >= nCol) break;
    }
    const lx = lx0 + col * cw;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8 * f);
    doc.text(doc.splitTextToSize(el.titre, cw - 3 * f)[0], lx, ly);
    ly += pas;
    if (el.pastilles) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6 * f);
      el.pastilles.forEach((p, k) => {
        const px = lx + (k % 2) * (cw / 2);
        const py = ly + Math.floor(k / 2) * pas;
        doc.setFillColor(p.couleur);
        doc.rect(px, py - 2.4 * f, 3 * f, 2.4 * f, "F");
        doc.text(doc.splitTextToSize(p.libelle, cw / 2 - 5 * f)[0], px + 4 * f, py - 0.3 * f);
      });
      ly += Math.ceil(el.pastilles.length / 2) * pas;
    }
  }
}

// --- Habillage PNG (canevas) ------------------------------------------------------------

function habillageCanvas(ctx: CanvasRenderingContext2D, r: Reglages, g: ReturnType<typeof gabarit>, pxParMm: number, solW: number, legende: ElementLegende[], site: string): void {
  const mm = (v: number) => v * pxParMm;
  const f = Math.max(1, Math.min(g.w, g.h) / 210);
  const x0 = mm(g.marge);
  const y0 = mm(g.marge);
  ctx.strokeStyle = "#28282a";
  ctx.lineWidth = mm(0.3 * f);
  ctx.strokeRect(x0, y0, mm(g.carteW), mm(g.carteH));
  const police = (taille: number, gras = false) => `${gras ? "600 " : ""}${mm(taille * 0.3528 * f)}px -apple-system, "Helvetica Neue", Arial, sans-serif`;

  // Nord
  const nx = x0 + mm(g.carteW - 10 * f);
  const ny = y0 + mm(6 * f);
  ctx.fillStyle = "#fff";
  ctx.fillRect(nx - mm(5 * f), ny - mm(2 * f), mm(10 * f), mm(15 * f));
  ctx.fillStyle = "#1d1d1f";
  ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx - mm(3 * f), ny + mm(9 * f)); ctx.lineTo(nx, ny + mm(7 * f)); ctx.fill();
  ctx.fillStyle = "#aaaaaf";
  ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx + mm(3 * f), ny + mm(9 * f)); ctx.lineTo(nx, ny + mm(7 * f)); ctx.fill();
  ctx.fillStyle = "#1d1d1f"; ctx.font = police(7, true); ctx.textAlign = "center";
  ctx.fillText("N", nx, ny + mm(12.5 * f));

  // Échelle graphique
  const mParMm = r.echelle / 1000;
  const L = longueurRonde(g.carteW * 0.22 * mParMm);
  const lmm = L / mParMm;
  const sx = x0 + mm(5 * f);
  const sy = y0 + mm(g.carteH - 7 * f);
  ctx.fillStyle = "#fff";
  ctx.fillRect(sx - mm(2.5 * f), sy - mm(6 * f), mm(lmm + 23 * f), mm(10 * f));
  ctx.strokeStyle = "#1d1d1f"; ctx.lineWidth = mm(0.2 * f);
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = k % 2 === 0 ? "#1d1d1f" : "#fff";
    ctx.fillRect(sx + mm((k * lmm) / 4), sy - mm(1.2 * f), mm(lmm / 4), mm(1.6 * f));
    ctx.strokeRect(sx + mm((k * lmm) / 4), sy - mm(1.2 * f), mm(lmm / 4), mm(1.6 * f));
  }
  ctx.fillStyle = "#1d1d1f"; ctx.font = police(6.5);
  ctx.fillText("0", sx, sy - mm(2.2 * f));
  ctx.fillText(L >= 1000 ? `${L / 1000} km` : `${L} m`, sx + mm(lmm), sy - mm(2.2 * f));
  ctx.textAlign = "left";
  ctx.fillText(`1/${r.echelle}`, sx + mm(lmm + 4 * f), sy + mm(0.4 * f));

  // Bandeau
  const by = y0 + mm(g.carteH + g.marge / 2);
  ctx.fillStyle = "#1d1d1f"; ctx.font = police(11, true);
  ctx.fillText(r.titre || "Plan", x0, by + mm(7 * f));
  ctx.font = police(7.5); ctx.fillStyle = "#48484d";
  const nomFormat = r.format === "libre" ? `${g.w} × ${g.h} mm` : `${r.format} ${r.paysage ? "paysage" : "portrait"}`;
  [site, `Échelle 1/${r.echelle} · ${nomFormat} · emprise ${Math.round(solW)} m de large`, `Édité le ${new Date().toLocaleDateString("fr-FR")} · nord en haut`]
    .filter(Boolean)
    .forEach((l, k) => ctx.fillText(l, x0, by + mm((15 + k * 3.6) * f)));
  ctx.font = police(5.8); ctx.fillStyle = "#6e6e73";
  ctx.fillText(`Sources : ${[...new Set(legende.map((l) => l.source))].join(" · ")}`, x0, by + mm(g.bandeau - 6 * f));

  const colCart = g.carteW * 0.42;
  let ly = by + mm(6 * f);
  let lx = x0 + mm(colCart + 4 * f);
  const colW = mm((g.carteW - colCart - 4 * f) / 2);
  for (const el of legende) {
    if (ly > by + mm(g.bandeau - 6 * f)) { ly = by + mm(6 * f); lx += colW; if (lx > x0 + mm(g.carteW) - 10) break; }
    ctx.fillStyle = "#1d1d1f"; ctx.font = police(6.8, true);
    ctx.fillText(el.titre, lx, ly);
    ly += mm(4 * f);
    if (el.pastilles) {
      ctx.font = police(6);
      el.pastilles.forEach((p, k) => {
        const px = lx + (k % 2) * (colW / 2);
        const py = ly + Math.floor(k / 2) * mm(4 * f);
        ctx.fillStyle = p.couleur; ctx.fillRect(px, py - mm(2.4 * f), mm(3 * f), mm(2.4 * f));
        ctx.fillStyle = "#1d1d1f"; ctx.fillText(p.libelle, px + mm(4 * f), py - mm(0.3 * f));
      });
      ly += Math.ceil(el.pastilles.length / 2) * mm(4 * f);
    }
  }
}

// --- Interface --------------------------------------------------------------------------

export function brancherMiseEnPage(o: OptionsMiseEnPage): void {
  const { map, carte } = o;
  const r: Reglages = { format: "A3", libre: [500, 700], paysage: true, echelle: 2000, dpi: 150, titre: "" };

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "mp-bouton";
  bouton.textContent = "Mise en page";
  carte.appendChild(bouton);

  const panneau = document.createElement("div");
  panneau.className = "mp-panneau m3d-panel";
  panneau.hidden = true;
  panneau.innerHTML = `
    <div class="mp-tete"><strong>Mise en page</strong>
      <button type="button" class="icon-btn mp-fermer" aria-label="Fermer la mise en page">✕</button></div>
    <label class="mp-champ"><span>Titre</span><input type="text" class="mp-titre" maxlength="90" placeholder="Plan de situation"></label>
    <div class="mp-champ"><span>Format</span>
      <div class="segmented seg-sm mp-formats" role="group" aria-label="Format">
        ${[...Object.keys(FORMATS), "libre"].map((k) => `<button type="button" data-format="${k}" aria-pressed="${k === r.format}">${k === "libre" ? "Libre" : k}</button>`).join("")}
      </div></div>
    <div class="mp-champ mp-libre" hidden><span>Format libre (mm)</span>
      <span class="mp-ligne"><input type="number" class="mp-lw" min="50" max="5000" step="10" value="${r.libre[0]}" aria-label="Largeur en millimètres"> ×
      <input type="number" class="mp-lh" min="50" max="5000" step="10" value="${r.libre[1]}" aria-label="Hauteur en millimètres"></span></div>
    <div class="mp-champ"><span>Orientation</span>
      <div class="segmented seg-sm" role="group" aria-label="Orientation">
        <button type="button" data-orient="portrait" aria-pressed="false">Portrait</button>
        <button type="button" data-orient="paysage" aria-pressed="true">Paysage</button>
      </div></div>
    <div class="mp-champ"><span>Échelle</span>
      <span class="mp-ligne"><span class="mp-un">1 /</span><input type="number" class="mp-echelle" min="100" max="500000" step="100" value="${r.echelle}" aria-label="Dénominateur d'échelle"></span>
      <span class="mp-presets">${[500, 1000, 2000, 5000, 10000].map((v) => `<button type="button" data-ech="${v}">1/${v}</button>`).join("")}</span></div>
    <div class="mp-champ"><span>Résolution</span>
      <div class="segmented seg-sm" role="group" aria-label="Résolution">
        <button type="button" data-dpi="150" aria-pressed="true">150 dpi</button>
        <button type="button" data-dpi="300" aria-pressed="false">300 dpi</button>
      </div></div>
    <p class="mp-info" aria-live="polite"></p>
    <div class="mp-actions">
      <button type="button" class="btn-primary mp-pdf">Exporter en PDF</button>
      <button type="button" class="btn-secondary mp-png">PNG</button>
    </div>
    <p class="mp-etat" aria-live="polite"></p>`;
  carte.appendChild(panneau);
  const q = <T extends HTMLElement>(s: string) => panneau.querySelector<T>(s)!;

  const majCadre = () => {
    const src = map.getSource("cadre") as maplibregl.GeoJSONSource | undefined;
    src?.setData(polygoneCadre(r, map.getCenter()));
    const g = gabarit(r);
    const e = emprise(r, map.getCenter());
    const px = Math.round((g.w / 25.4) * r.dpi) * Math.round((g.h / 25.4) * r.dpi);
    q<HTMLElement>(".mp-info").textContent =
      `Feuille ${g.w} × ${g.h} mm · carte ${Math.round(g.carteW)} × ${Math.round(g.carteH)} mm, ` +
      `soit ${Math.round(e.solW)} × ${Math.round(e.solH)} m au sol. ` +
      `Image ${(px / 1e6).toFixed(0)} Mpx${px > 60e6 ? " : export long, préférez 150 dpi" : ""}. Déplacez la carte pour placer le cadre.`;
  };

  const margesVisibles = () =>
    window.matchMedia("(max-width: 800px)").matches
      ? { top: 70, left: 12, right: 12, bottom: Math.round(carte.clientHeight * 0.62) + 12 }
      : { top: 70, left: 24, right: 380, bottom: 40 };

  function ouvrir(v: boolean): void {
    panneau.hidden = !v;
    bouton.hidden = v;
    if (v) {
      if (!map.getSource("cadre")) {
        map.addSource("cadre", { type: "geojson", data: polygoneCadre(r, map.getCenter()) });
        map.addLayer({ id: "cadre-masque", type: "fill", source: "cadre", filter: ["==", ["get", "role"], "masque"], paint: { "fill-color": "#1d1d1f", "fill-opacity": 0.28 } });
        map.addLayer({ id: "cadre-ligne", type: "line", source: "cadre", filter: ["==", ["get", "role"], "cadre"], paint: { "line-color": "#1d1d1f", "line-width": 2 } });
      }
      map.setLayoutProperty("cadre-masque", "visibility", "visible");
      map.setLayoutProperty("cadre-ligne", "visibility", "visible");
      // Vue imprimée : nord en haut, sans inclinaison.
      o.passer2D();
      map.easeTo({ pitch: 0, bearing: 0, duration: 400 });
      // Titre par défaut : repris à l'export si le site n'est pas encore chargé.
      const siteActuel = o.site();
      if (!r.titre && siteActuel) {
        r.titre = `Plan de situation — ${siteActuel.label}`;
        q<HTMLInputElement>(".mp-titre").value = r.titre;
      }
      // Zoom pour voir tout le cadre.
      const e = emprise(r, map.getCenter());
      const [w, s] = merc2ll(e.cx - e.larg * 0.6, e.cy - e.haut * 0.6);
      const [est, n] = merc2ll(e.cx + e.larg * 0.6, e.cy + e.haut * 0.6);
      // Le panneau couvre la droite (ordinateur) ou le bas (téléphone) de la
      // carte : on décale le centre de la carte vers la partie visible, et le
      // cadre suit ce centre.
      map.setPadding(margesVisibles());
      map.fitBounds([[w, s], [est, n]], { duration: 400 });
      majCadre();
    } else if (map.getLayer("cadre-ligne")) {
      map.setLayoutProperty("cadre-masque", "visibility", "none");
      map.setLayoutProperty("cadre-ligne", "visibility", "none");
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    }
  }
  bouton.addEventListener("click", () => ouvrir(true));
  q<HTMLButtonElement>(".mp-fermer").addEventListener("click", () => ouvrir(false));
  map.on("move", () => { if (!panneau.hidden) majCadre(); });

  const segment = (attr: string, f: (v: string) => void) =>
    panneau.querySelectorAll<HTMLButtonElement>(`[${attr}]`).forEach((b) =>
      b.addEventListener("click", () => {
        panneau.querySelectorAll(`[${attr}]`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        f(b.getAttribute(attr)!);
        majCadre();
      }),
    );
  segment("data-format", (v) => {
    r.format = v as NomFormat;
    q<HTMLElement>(".mp-libre").hidden = v !== "libre";
  });
  segment("data-orient", (v) => (r.paysage = v === "paysage"));
  segment("data-dpi", (v) => (r.dpi = Number(v)));
  panneau.querySelectorAll<HTMLButtonElement>("[data-ech]").forEach((b) =>
    b.addEventListener("click", () => {
      r.echelle = Number(b.dataset.ech);
      q<HTMLInputElement>(".mp-echelle").value = String(r.echelle);
      majCadre();
    }),
  );
  q<HTMLInputElement>(".mp-echelle").addEventListener("input", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (v >= 100 && v <= 500000) { r.echelle = Math.round(v); majCadre(); }
  });
  for (const [cls, k] of [[".mp-lw", 0], [".mp-lh", 1]] as const) {
    q<HTMLInputElement>(cls).addEventListener("input", (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (v >= 50 && v <= 5000) { r.libre[k] = v; majCadre(); }
    });
  }
  q<HTMLInputElement>(".mp-titre").addEventListener("input", (e) => (r.titre = (e.target as HTMLInputElement).value));

  // --- Export ---------------------------------------------------------------
  const etat = q<HTMLElement>(".mp-etat");
  const boutons = [q<HTMLButtonElement>(".mp-pdf"), q<HTMLButtonElement>(".mp-png")];
  const nomFichier = (ext: string) =>
    `${(r.titre || "plan").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "plan"}_1-${r.echelle}.${ext}`;

  async function exporter(type: "pdf" | "png"): Promise<void> {
    const g = gabarit(r);
    const centre = map.getCenter();
    const e = emprise(r, centre);
    const legende = o.legende();
    const site = o.site()?.label ?? "";
    if (!r.titre) r.titre = site ? `Plan de situation — ${site}` : "Plan de situation";
    let dpi = r.dpi;
    if (type === "png") {
      // Une seule image : on reste sous la limite de Safari.
      const pxPage = (g.w / 25.4) * (g.h / 25.4) * dpi * dpi;
      if (pxPage > PNG_MAX_PX) dpi = Math.floor(Math.sqrt(PNG_MAX_PX / ((g.w / 25.4) * (g.h / 25.4))));
    }
    const pxParMm = dpi / 25.4;
    const pxW = Math.round(g.carteW * pxParMm);
    const pxH = Math.round(g.carteH * pxParMm);
    boutons.forEach((b) => (b.disabled = true));
    try {
      if (type === "pdf") {
        const doc = new jsPDF({ orientation: g.w > g.h ? "landscape" : "portrait", unit: "mm", format: [g.w, g.h], compress: true });
        await rendre(map, r, centre, pxW, pxH, (img, x, y) => {
          doc.addImage(img.toDataURL("image/jpeg", 0.9), "JPEG", g.marge + x / pxParMm, g.marge + y / pxParMm, img.width / pxParMm, img.height / pxParMm, undefined, "FAST");
        }, (f, t) => (etat.textContent = `Rendu de la carte : ${f}/${t}…`));
        habillagePdf(doc, r, g, e.solW, legende, site);
        doc.save(nomFichier("pdf"));
      } else {
        const c = document.createElement("canvas");
        c.width = Math.round(g.w * pxParMm);
        c.height = Math.round(g.h * pxParMm);
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        await rendre(map, r, centre, pxW, pxH, (img, x, y) => ctx.drawImage(img, Math.round(g.marge * pxParMm) + x, Math.round(g.marge * pxParMm) + y),
          (f, t) => (etat.textContent = `Rendu de la carte : ${f}/${t}…`));
        habillageCanvas(ctx, r, g, pxParMm, e.solW, legende, site);
        const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
        if (!blob) throw new Error("image trop grande");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = nomFichier("png");
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      etat.textContent = `Export terminé (${dpi} dpi).`;
    } catch (err) {
      etat.textContent = `Export impossible : ${(err as Error).message}. Essayez 150 dpi ou un format plus petit.`;
    } finally {
      boutons.forEach((b) => (b.disabled = false));
    }
  }
  boutons[0].addEventListener("click", () => void exporter("pdf"));
  boutons[1].addEventListener("click", () => void exporter("png"));
}
