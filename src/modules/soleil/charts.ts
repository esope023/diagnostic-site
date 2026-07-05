// Configs Chart.js partagées écran/export.
import type { ChartConfiguration } from "chart.js";
import type { SoleilResult } from "./compute";

const MOIS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** Diagramme de masques : silhouette du masque bâti + trajectoires solaires. */
export function masqueSolaireConfig(r: SoleilResult): ChartConfiguration {
  const maskPoints = r.horizonMaskDeg.map((elev, i) => ({ x: i * 10 + 5, y: elev }));

  const pathColors = ["#2980b9", "#f39c12", "#c0392b"];
  const pathDatasets = r.sunPaths.map((path, i) => ({
    label: path.label,
    data: path.points.map((p) => ({ x: p.azimuthDeg, y: p.elevationDeg })),
    borderColor: pathColors[i % pathColors.length],
    backgroundColor: "transparent",
    showLine: true,
    pointRadius: 0,
    borderWidth: 2,
  }));

  return {
    type: "line",
    data: {
      datasets: [
        {
          label: "Masque bâti (horizon obstrué)",
          data: maskPoints,
          borderColor: "rgba(80, 80, 80, 0.7)",
          backgroundColor: "rgba(80, 80, 80, 0.25)",
          fill: "origin",
          stepped: "middle",
          pointRadius: 0,
          borderWidth: 1,
        },
        ...pathDatasets,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 360,
          title: { display: true, text: "Azimut (° depuis le Nord)" },
          ticks: { stepSize: 45 },
        },
        y: {
          min: 0,
          max: 90,
          title: { display: true, text: "Élévation (°)" },
        },
      },
    },
  };
}

export function ensoleillementConfig(r: SoleilResult): ChartConfiguration {
  return {
    type: "bar",
    data: {
      labels: MOIS,
      datasets: [
        {
          label: "Théorique (sans masque)",
          data: r.monthlyTheoreticalHours,
          backgroundColor: "rgba(243, 156, 18, 0.35)",
        },
        {
          label: "Réel estimé (avec masque bâti)",
          data: r.monthlyMaskedHours,
          backgroundColor: "rgba(243, 156, 18, 0.85)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "h / jour" } } },
    },
  };
}

export function pvConfig(monthlyKwhPerKwc: number[]): ChartConfiguration {
  return {
    type: "bar",
    data: {
      labels: MOIS,
      datasets: [
        {
          label: "Production estimée (kWh / kWc)",
          data: monthlyKwhPerKwc,
          backgroundColor: "rgba(39, 174, 96, 0.7)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "kWh/kWc" } } },
    },
  };
}
