// Pictogrammes au trait (24 × 24), dans l'esprit de la maquette validée :
// une seule épaisseur, couleur héritée du texte (currentColor).

const P: Record<string, string> = {
  climat: `<path d="M12 14V4a2 2 0 1 0-4 0v10a4 4 0 1 0 4 0z"/><path d="M16 6h4M16 10h3"/>`,
  vent: `<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>`,
  eau: `<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>`,
  reglementaire: `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.5h6V4M8.5 10h7M8.5 14h7M8.5 18h4"/>`,
  nature: `<path d="M5 19c0-8 5-14 14-14 0 9-6 14-14 14z"/><path d="M5 19l7-7"/>`,
  urbanisme: `<path d="M4 21V9l6-4v16M10 21V3l10 5v13M2 21h20"/>`,
  soleil: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
  mobilites: `<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17l4-8h6l2 8M9 6h3"/>`,
};

const FALLBACK = `<circle cx="12" cy="12" r="8"/>`;

/** Pictogramme SVG du module, à insérer tel quel dans le HTML. */
export function moduleIcon(id: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[id] ?? FALLBACK}</svg>`;
}
