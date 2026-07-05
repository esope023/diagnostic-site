// Config Chart.js partagée écran/export : répartition sommaire de l'occupation
// du sol dans le rayon (végétalisé / eau / autre).
import type { ChartConfiguration } from "chart.js";
import type { NatureResult } from "./compute";

export function occupationSolConfig(r: NatureResult): ChartConfiguration {
  const autre = Math.max(0, 100 - r.greenPct - r.waterPct);
  return {
    type: "doughnut",
    data: {
      labels: ["Végétalisé", "Eau", "Autre (bâti, voirie, sol nu…)"],
      datasets: [
        {
          data: [r.greenPct, r.waterPct, autre],
          backgroundColor: ["#27ae60", "#2980b9", "#bdc3c7"],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    },
  };
}
