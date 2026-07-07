// Config Chart.js partagée écran/export : longueur d'infrastructure cyclable
// par catégorie.
import type { ChartConfiguration } from "chart.js";
import type { MobilitesResult } from "./compute";

export function cyclingConfig(r: MobilitesResult): ChartConfiguration {
  return {
    type: "bar",
    data: {
      labels: ["Aménagée (piste/site propre)", "Partagée (bande/voie mixte)", "En projet"],
      datasets: [
        {
          label: "Longueur (km)",
          data: [r.cyclingKmAmenagee, r.cyclingKmPartagee, r.cyclingKmProjet],
          backgroundColor: ["#27ae60", "#f39c12", "#95a5a6"],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, title: { display: true, text: "km" } } },
    },
  };
}
