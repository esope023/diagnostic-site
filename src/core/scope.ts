// Cadrages d'analyse disponibles ("quartier" vs "parcelle").
// Un seul endroit à modifier pour ajouter/retirer un préréglage.
export interface RadiusPreset {
  /** Valeur utilisée dans le <select> et comme clé de comparaison. */
  value: string;
  label: string;
  /** Rayon en mètres, ou null pour "Parcelle" (pas de cercle, échelle bâtiment). */
  meters: number | null;
}

export const RADIUS_PRESETS: RadiusPreset[] = [
  { value: "parcelle", label: "Parcelle", meters: null },
  { value: "100", label: "100 m", meters: 100 },
  { value: "300", label: "300 m (défaut)", meters: 300 },
  { value: "600", label: "600 m", meters: 600 },
  { value: "1000", label: "1000 m", meters: 1000 },
];

export const DEFAULT_RADIUS_VALUE = "300";

export function radiusValueToMeters(value: string): number | null {
  return RADIUS_PRESETS.find((p) => p.value === value)?.meters ?? null;
}
