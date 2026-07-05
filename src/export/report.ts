// Génération du rapport PDF.
// Principe : chaque module fournit un ExportBlock. On rend les graphes Chart.js
// hors écran en images (qualité nette), on capture la carte, on assemble en PDF.
import { Chart } from "chart.js/auto";
import type { ChartConfiguration } from "chart.js";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import type { ExportBlock, SiteContext } from "../core/types";

/** Rend une config Chart.js sur un canvas détaché et renvoie une image PNG. */
async function chartToImage(config: ChartConfiguration): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 420;
  // Hors flux : animation coupée pour un rendu synchrone.
  const cfg: ChartConfiguration = {
    ...config,
    options: { ...(config.options ?? {}), animation: false, responsive: false },
  };
  const chart = new Chart(canvas, cfg);
  const img = chart.toBase64Image("image/png", 1);
  chart.destroy();
  return img;
}

async function mapToImage(mapEl: HTMLElement | null): Promise<string | null> {
  if (!mapEl) return null;
  try {
    const canvas = await html2canvas(mapEl, { useCORS: true, logging: false });
    return canvas.toDataURL("image/png");
  } catch {
    return null; // la carte échoue -> rapport sans capture, pas de blocage
  }
}

const A4 = { w: 210, h: 297, margin: 14 };

export async function generateReport(
  blocks: ExportBlock[],
  ctx: SiteContext,
  mapEl: HTMLElement | null,
): Promise<void> {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  let y = A4.margin;

  const ensureSpace = (h: number) => {
    if (y + h > A4.h - A4.margin) {
      pdf.addPage();
      y = A4.margin;
    }
  };

  // En-tête
  pdf.setFontSize(18);
  pdf.text("Diagnostic de site", A4.margin, y);
  y += 8;
  pdf.setFontSize(11);
  pdf.text(ctx.label, A4.margin, y);
  y += 5;
  const alt = ctx.altitude !== null ? `${ctx.altitude} m` : "n.d.";
  pdf.text(
    `Lat ${ctx.lat.toFixed(5)} · Lon ${ctx.lon.toFixed(5)} · Altitude ${alt}`,
    A4.margin,
    y,
  );
  y += 8;

  // Carte
  const mapImg = await mapToImage(mapEl);
  if (mapImg) {
    const w = A4.w - 2 * A4.margin;
    const h = w * 0.6;
    ensureSpace(h + 4);
    pdf.addImage(mapImg, "PNG", A4.margin, y, w, h);
    y += h + 6;
  }

  // Blocs modules
  for (const block of blocks) {
    ensureSpace(16);
    pdf.setFontSize(14);
    pdf.text(block.title, A4.margin, y);
    y += 6;

    pdf.setFontSize(10);
    for (const line of pdf.splitTextToSize(block.summary, A4.w - 2 * A4.margin)) {
      ensureSpace(5);
      pdf.text(line, A4.margin, y);
      y += 5;
    }
    y += 2;

    // Indicateurs (2 colonnes)
    pdf.setFontSize(9);
    const colW = (A4.w - 2 * A4.margin) / 2;
    block.indicators.forEach((ind, i) => {
      const col = i % 2;
      if (col === 0) ensureSpace(5);
      pdf.text(`${ind.label} : ${ind.value}`, A4.margin + col * colW, y);
      if (col === 1 || i === block.indicators.length - 1) y += 5;
    });
    y += 2;

    // Graphes
    for (const chart of block.charts) {
      const img = await chartToImage(chart.config as ChartConfiguration);
      const w = A4.w - 2 * A4.margin;
      const h = w * (420 / 900);
      ensureSpace(h + 4);
      pdf.addImage(img, "PNG", A4.margin, y, w, h);
      y += h + 4;
    }

    if (block.notes?.length) {
      pdf.setFontSize(8);
      for (const note of block.notes) {
        for (const line of pdf.splitTextToSize(note, A4.w - 2 * A4.margin)) {
          ensureSpace(4);
          pdf.text(line, A4.margin, y);
          y += 4;
        }
      }
      y += 3;
    }
  }

  // Attributions
  ensureSpace(10);
  pdf.setFontSize(7);
  pdf.text(
    "Données : © OpenStreetMap · © IGN/Géoplateforme (Etalab 2.0) · Open-Meteo · PVGIS © UE",
    A4.margin,
    A4.h - 8,
  );

  const slug = ctx.commune?.toLowerCase().replace(/\s+/g, "-") ?? "site";
  pdf.save(`diagnostic-${slug}.pdf`);
}
