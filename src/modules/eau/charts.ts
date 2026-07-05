// Config Chart.js partagée écran/export : volume mensuel récupérable.
import type { ChartConfiguration } from "chart.js";
import type { EauResult } from "./compute";

const MOIS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export function volumeMensuelConfig(r: EauResult): ChartConfiguration {
  return {
    type: "bar",
    data: {
      labels: MOIS,
      datasets: [
        {
          label: "Volume récupérable (L)",
          data: r.monthlyVolumeL,
          backgroundColor: "rgba(41, 128, 185, 0.6)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "litres" } } },
    },
  };
}
