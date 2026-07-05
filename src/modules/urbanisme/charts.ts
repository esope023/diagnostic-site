// Config Chart.js partagée écran/export : répartition des orientations
// dominantes des bâtiments (par surface).
import type { ChartConfiguration } from "chart.js";
import { ORIENTATION_LABELS, type UrbanismeResult } from "./compute";

export function orientationConfig(r: UrbanismeResult): ChartConfiguration {
  return {
    type: "bar",
    data: {
      labels: ORIENTATION_LABELS,
      datasets: [
        {
          label: "Part de l'emprise bâtie (%)",
          data: r.orientationPct,
          backgroundColor: "rgba(142, 68, 173, 0.6)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: "%" } } },
      plugins: { legend: { display: false } },
    },
  };
}
