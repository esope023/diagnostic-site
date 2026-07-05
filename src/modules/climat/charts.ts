// Configs Chart.js partagées entre l'affichage (render) et l'export.
// Les garder ici évite toute divergence entre écran et rapport.
import type { ChartConfiguration } from "chart.js";
import type { ClimatResult } from "./compute";

const MOIS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** Diagramme ombrothermique simplifié : températures + précipitations. */
export function tempPrecipConfig(r: ClimatResult): ChartConfiguration {
  return {
    type: "bar",
    data: {
      labels: MOIS,
      datasets: [
        {
          type: "line",
          label: "T° max (°C)",
          data: r.monthly.tMax,
          borderColor: "#c0392b",
          backgroundColor: "transparent",
          yAxisID: "y",
          tension: 0.3,
        },
        {
          type: "line",
          label: "T° min (°C)",
          data: r.monthly.tMin,
          borderColor: "#2980b9",
          backgroundColor: "transparent",
          yAxisID: "y",
          tension: 0.3,
        },
        {
          type: "bar",
          label: "Précip. (mm)",
          data: r.monthly.precip,
          backgroundColor: "rgba(52, 152, 219, 0.35)",
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { position: "left", title: { display: true, text: "°C" } },
        y1: {
          position: "right",
          title: { display: true, text: "mm" },
          grid: { drawOnChartArea: false },
          beginAtZero: true,
        },
      },
    },
  };
}

/** Rayonnement solaire mensuel (MJ/m²). */
export function rayonnementConfig(r: ClimatResult): ChartConfiguration {
  return {
    type: "bar",
    data: {
      labels: MOIS,
      datasets: [
        {
          label: "Rayonnement (MJ/m²)",
          data: r.monthly.rayonnement,
          backgroundColor: "rgba(243, 156, 18, 0.6)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "MJ/m²" } } },
    },
  };
}

/** Comparaison référence / horizons de projection pour deux indicateurs clés. */
export function projectionsConfig(
  baseline: ClimatResult,
  horizons: { label: string; indicators: { nuitsTropicales: number; joursChaleur30: number } }[],
): ChartConfiguration {
  const labels = ["Référence 1991-2020", ...horizons.map((h) => h.label)];
  const nuitsTropicales = [baseline.nuitsTropicales, ...horizons.map((h) => h.indicators.nuitsTropicales)];
  const joursChaleur30 = [baseline.joursChaleur30, ...horizons.map((h) => h.indicators.joursChaleur30)];

  return {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Nuits tropicales / an",
          data: nuitsTropicales,
          backgroundColor: "rgba(192, 57, 43, 0.7)",
        },
        {
          label: "Jours ≥ 30 °C / an",
          data: joursChaleur30,
          backgroundColor: "rgba(243, 156, 18, 0.7)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "jours / an" } } },
    },
  };
}
