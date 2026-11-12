// Thème clair / sombre : suit le système par défaut, peut être forcé.
// Les graphiques Chart.js reprennent les couleurs de texte et de grille.

import { Chart } from "chart.js/auto";

export type ThemeChoice = "auto" | "light" | "dark";
const KEY = "diag-theme";
const ORDER: ThemeChoice[] = ["auto", "light", "dark"];
const LABEL: Record<ThemeChoice, string> = {
  auto: "Thème : automatique",
  light: "Thème : clair",
  dark: "Thème : sombre",
};
const media = window.matchMedia("(prefers-color-scheme: dark)");

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Couleurs de texte et de grille des graphiques, lues dans les variables CSS. */
export function applyChartTheme(): void {
  Chart.defaults.color = css("--muted") || "#6E6E73";
  Chart.defaults.borderColor = css("--grid") || "rgba(0,0,0,0.08)";
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  for (const c of Object.values(Chart.instances)) {
    const r = (c.options.scales as Record<string, { grid?: { color?: unknown }; ticks?: { color?: unknown } }> | undefined);
    if (r) for (const s of Object.values(r)) {
      if (s.grid) s.grid.color = Chart.defaults.borderColor;
      if (s.ticks) s.ticks.color = Chart.defaults.color;
    }
    c.update("none");
  }
}

function apply(choice: ThemeChoice, btn: HTMLButtonElement | null): void {
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.dataset.theme = choice;
  if (btn) {
    btn.dataset.choice = choice;
    btn.title = LABEL[choice];
    btn.setAttribute("aria-label", LABEL[choice]);
  }
  applyChartTheme();
}

export function initTheme(btn: HTMLButtonElement | null): void {
  let choice = stored();
  apply(choice, btn);
  btn?.addEventListener("click", () => {
    choice = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* stockage indisponible : le choix vaut pour la session */
    }
    apply(choice, btn);
  });
  media.addEventListener("change", () => {
    if (choice === "auto") applyChartTheme();
  });
}
