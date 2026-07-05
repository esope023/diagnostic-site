// Configs Chart.js pour les roses des vents (polaire).
// Chart.js n'a pas de type "wind rose" natif ; on utilise "polarArea" avec
// 16 secteurs = fréquence (%), et une couleur par secteur reflétant la
// vitesse moyenne (plus foncé = plus venté). C'est une approximation
// lisible, pas un rendu météorologique normé (pas de bins de vitesse empilés).
import type { ChartConfiguration } from "chart.js";
import { SECTOR_LABELS, type SeasonRose } from "./compute";

/** Couleur d'un secteur selon sa vitesse moyenne (échelle simple 0-10 m/s). */
function speedColor(speed: number): string {
  const t = Math.min(speed / 10, 1); // 0 = calme, 1 = ≥10 m/s
  const r = Math.round(52 + t * (192 - 52));
  const g = Math.round(152 - t * (152 - 57));
  const b = Math.round(219 - t * (219 - 43));
  return `rgba(${r}, ${g}, ${b}, 0.75)`;
}

export function roseConfig(rose: SeasonRose, title: string): ChartConfiguration {
  return {
    type: "polarArea",
    data: {
      labels: SECTOR_LABELS,
      datasets: [
        {
          label: title,
          data: rose.frequency,
          backgroundColor: rose.meanSpeed.map(speedColor),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: title },
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const i = ctx.dataIndex;
              return [
                `Fréquence : ${rose.frequency[i]} %`,
                `Vitesse moy. : ${rose.meanSpeed[i]} m/s`,
              ];
            },
          },
        },
      },
      scales: {
        r: {
          ticks: { display: false },
          grid: { color: "rgba(0,0,0,0.08)" },
        },
      },
    },
  };
}
