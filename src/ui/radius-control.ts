// Périmètre d'analyse : boutons segmentés (préréglages) + distance libre.
// La distance saisie l'emporte tant qu'elle est valide ; cliquer un
// préréglage la vide.

import { RADIUS_PRESETS, DEFAULT_RADIUS_VALUE, radiusValueToMeters } from "../core/scope";

export const CUSTOM_RADIUS_MIN = 20;
export const CUSTOM_RADIUS_MAX = 5000;

export interface RadiusControl {
  /** Rayon en mètres, ou null pour l'échelle parcelle. */
  getMeters(): number | null;
}

export function attachRadiusControl(
  root: HTMLElement,
  onChange: (meters: number | null) => void,
): RadiusControl {
  let preset = DEFAULT_RADIUS_VALUE;
  let custom: number | null = null;

  const group = document.createElement("div");
  group.className = "segmented";
  for (const p of RADIUS_PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.value = p.value;
    b.textContent = p.label;
    group.appendChild(b);
  }

  const sep = document.createElement("span");
  sep.className = "segmented-sep";
  sep.setAttribute("aria-hidden", "true");

  const label = document.createElement("label");
  label.className = "segmented-custom";
  label.innerHTML = `<span class="visually-hidden">Distance personnalisée en mètres</span>
    <input type="number" inputmode="numeric" min="${CUSTOM_RADIUS_MIN}" max="${CUSTOM_RADIUS_MAX}"
      step="10" placeholder="Autre" /><span aria-hidden="true">m</span>`;
  const input = label.querySelector("input")!;

  group.append(sep, label);
  root.replaceChildren(group);

  function paint(): void {
    group.querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((b) => {
      b.setAttribute("aria-pressed", String(custom === null && b.dataset.value === preset));
    });
    label.classList.toggle("active", custom !== null);
  }

  group.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
    if (!b) return;
    preset = b.dataset.value!;
    custom = null;
    input.value = "";
    paint();
    onChange(radiusValueToMeters(preset));
  });

  function readCustom(): void {
    const v = Number(input.value);
    if (input.value.trim() === "") {
      if (custom === null) return;
      custom = null;
    } else if (!Number.isFinite(v) || v < CUSTOM_RADIUS_MIN || v > CUSTOM_RADIUS_MAX) {
      input.setCustomValidity(`Entre ${CUSTOM_RADIUS_MIN} et ${CUSTOM_RADIUS_MAX} m`);
      input.reportValidity();
      return;
    } else {
      const r = Math.round(v);
      if (r === custom) return;
      custom = r;
    }
    input.setCustomValidity("");
    paint();
    onChange(control.getMeters());
  }
  input.addEventListener("change", readCustom);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // n'envoie pas le formulaire de recherche
      readCustom();
    }
  });
  input.addEventListener("input", () => input.setCustomValidity(""));

  const control: RadiusControl = {
    getMeters: () => custom ?? radiusValueToMeters(preset),
  };
  paint();
  return control;
}
