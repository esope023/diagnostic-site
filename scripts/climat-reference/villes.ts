// Villes de référence pour situer un site (classement C.3) et chercher son
// analogue climatique (C.4). Quelques villes par région, plus de grandes villes
// d'Europe du Sud : elles ne servent qu'à l'analogue (leur climat actuel).
// Coordonnées du centre-ville, en degrés décimaux.

export interface VilleReference {
  nom: string;
  region: string;
  pays: "FR" | "ES" | "PT" | "IT" | "GR" | "TN" | "DZ";
  lat: number;
  lon: number;
}

// Ordre = ordre de calcul : les plus utiles d'abord, pour que les encarts
// deviennent lisibles avant la fin du calcul complet.
export const VILLES: VilleReference[] = [
  { nom: "Paris", region: "Île-de-France", pays: "FR", lat: 48.857, lon: 2.352 },
  { nom: "Marseille", region: "Provence-Alpes-Côte d'Azur", pays: "FR", lat: 43.296, lon: 5.37 },
  { nom: "Lyon", region: "Auvergne-Rhône-Alpes", pays: "FR", lat: 45.758, lon: 4.835 },
  { nom: "Toulouse", region: "Occitanie", pays: "FR", lat: 43.605, lon: 1.444 },
  { nom: "Bordeaux", region: "Nouvelle-Aquitaine", pays: "FR", lat: 44.838, lon: -0.579 },
  { nom: "Lille", region: "Hauts-de-France", pays: "FR", lat: 50.629, lon: 3.057 },
  { nom: "Nantes", region: "Pays de la Loire", pays: "FR", lat: 47.218, lon: -1.554 },
  { nom: "Strasbourg", region: "Grand Est", pays: "FR", lat: 48.573, lon: 7.752 },
  { nom: "Rennes", region: "Bretagne", pays: "FR", lat: 48.111, lon: -1.68 },
  { nom: "Rouen", region: "Normandie", pays: "FR", lat: 49.443, lon: 1.099 },
  { nom: "Dijon", region: "Bourgogne-Franche-Comté", pays: "FR", lat: 47.322, lon: 5.041 },
  { nom: "Orléans", region: "Centre-Val de Loire", pays: "FR", lat: 47.903, lon: 1.909 },
  { nom: "Ajaccio", region: "Corse", pays: "FR", lat: 41.919, lon: 8.738 },
  { nom: "Montpellier", region: "Occitanie", pays: "FR", lat: 43.611, lon: 3.877 },
  { nom: "Nice", region: "Provence-Alpes-Côte d'Azur", pays: "FR", lat: 43.71, lon: 7.262 },
  // Europe du Sud et Maghreb : climat actuel seulement (analogues).
  { nom: "Séville", region: "Andalousie", pays: "ES", lat: 37.389, lon: -5.984 },
  { nom: "Madrid", region: "Communauté de Madrid", pays: "ES", lat: 40.417, lon: -3.704 },
  { nom: "Barcelone", region: "Catalogne", pays: "ES", lat: 41.389, lon: 2.159 },
  { nom: "Valence", region: "Communauté valencienne", pays: "ES", lat: 39.47, lon: -0.376 },
  { nom: "Bilbao", region: "Pays basque", pays: "ES", lat: 43.263, lon: -2.935 },
  { nom: "Lisbonne", region: "Lisbonne", pays: "PT", lat: 38.722, lon: -9.139 },
  { nom: "Porto", region: "Nord", pays: "PT", lat: 41.15, lon: -8.611 },
  { nom: "Rome", region: "Latium", pays: "IT", lat: 41.903, lon: 12.496 },
  { nom: "Milan", region: "Lombardie", pays: "IT", lat: 45.464, lon: 9.19 },
  { nom: "Florence", region: "Toscane", pays: "IT", lat: 43.77, lon: 11.256 },
  { nom: "Naples", region: "Campanie", pays: "IT", lat: 40.852, lon: 14.268 },
  { nom: "Palerme", region: "Sicile", pays: "IT", lat: 38.116, lon: 13.361 },
  { nom: "Athènes", region: "Attique", pays: "GR", lat: 37.984, lon: 23.728 },
  { nom: "Tunis", region: "Tunis", pays: "TN", lat: 36.806, lon: 10.181 },
  { nom: "Alger", region: "Alger", pays: "DZ", lat: 36.754, lon: 3.059 },
  // Autres villes françaises.
  { nom: "Grenoble", region: "Auvergne-Rhône-Alpes", pays: "FR", lat: 45.188, lon: 5.724 },
  { nom: "Clermont-Ferrand", region: "Auvergne-Rhône-Alpes", pays: "FR", lat: 45.778, lon: 3.087 },
  { nom: "Besançon", region: "Bourgogne-Franche-Comté", pays: "FR", lat: 47.238, lon: 6.024 },
  { nom: "Nevers", region: "Bourgogne-Franche-Comté", pays: "FR", lat: 46.99, lon: 3.159 },
  { nom: "Brest", region: "Bretagne", pays: "FR", lat: 48.39, lon: -4.486 },
  { nom: "Vannes", region: "Bretagne", pays: "FR", lat: 47.658, lon: -2.76 },
  { nom: "Tours", region: "Centre-Val de Loire", pays: "FR", lat: 47.394, lon: 0.684 },
  { nom: "Bourges", region: "Centre-Val de Loire", pays: "FR", lat: 47.081, lon: 2.399 },
  { nom: "Bastia", region: "Corse", pays: "FR", lat: 42.697, lon: 9.45 },
  { nom: "Reims", region: "Grand Est", pays: "FR", lat: 49.258, lon: 4.032 },
  { nom: "Nancy", region: "Grand Est", pays: "FR", lat: 48.692, lon: 6.184 },
  { nom: "Amiens", region: "Hauts-de-France", pays: "FR", lat: 49.894, lon: 2.296 },
  { nom: "Dunkerque", region: "Hauts-de-France", pays: "FR", lat: 51.034, lon: 2.377 },
  { nom: "Melun", region: "Île-de-France", pays: "FR", lat: 48.54, lon: 2.66 },
  { nom: "Cergy", region: "Île-de-France", pays: "FR", lat: 49.036, lon: 2.076 },
  { nom: "Caen", region: "Normandie", pays: "FR", lat: 49.182, lon: -0.371 },
  { nom: "Cherbourg", region: "Normandie", pays: "FR", lat: 49.639, lon: -1.616 },
  { nom: "Limoges", region: "Nouvelle-Aquitaine", pays: "FR", lat: 45.834, lon: 1.262 },
  { nom: "La Rochelle", region: "Nouvelle-Aquitaine", pays: "FR", lat: 46.16, lon: -1.151 },
  { nom: "Pau", region: "Nouvelle-Aquitaine", pays: "FR", lat: 43.295, lon: -0.371 },
  { nom: "Perpignan", region: "Occitanie", pays: "FR", lat: 42.699, lon: 2.895 },
  { nom: "Nîmes", region: "Occitanie", pays: "FR", lat: 43.837, lon: 4.36 },
  { nom: "Angers", region: "Pays de la Loire", pays: "FR", lat: 47.478, lon: -0.563 },
  { nom: "Le Mans", region: "Pays de la Loire", pays: "FR", lat: 48.006, lon: 0.199 },
  { nom: "Avignon", region: "Provence-Alpes-Côte d'Azur", pays: "FR", lat: 43.949, lon: 4.806 },
  { nom: "Gap", region: "Provence-Alpes-Côte d'Azur", pays: "FR", lat: 44.559, lon: 6.079 },
];
