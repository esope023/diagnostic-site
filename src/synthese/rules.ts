// ---------------------------------------------------------------------------
// Synthèse hiérarchisée des enjeux — moteur de règles croisées.
//
// PRINCIPE (aligné sur la charte de transparence du projet) :
// - Chaque enjeu est déclenché par des SIGNAUX explicites : un signal = un
//   indicateur d'un module, un seuil écrit en constante commentée, un poids
//   (1 ou 2). Le score d'un enjeu = somme des poids. Aucune pondération
//   cachée, aucun apprentissage, aucune magie.
// - Chaque signal affiché porte sa valeur et son module d'origine : le
//   lecteur peut toujours remonter au chiffre qui fonde l'enjeu.
// - Données manquantes = dit explicitement ("non évalué"), jamais silencieux.
//   Un module en échec réduit la portée de la synthèse, il ne l'invalide pas.
// - La hiérarchie produite est INDICATIVE : c'est une aide à la lecture
//   croisée, pas un jugement automatique — l'arbitrage reste au praticien.
//
// Pur, sans I/O : consomme les Result des modules via un objet d'entrée.
// ---------------------------------------------------------------------------
import type { ClimatResult } from "../modules/climat/compute";
import type { VentResult } from "../modules/vent/compute";
import type { EauResult } from "../modules/eau/compute";
import type { NatureResult } from "../modules/nature/compute";
import type { UrbanismeResult } from "../modules/urbanisme/compute";
import type { SoleilResult } from "../modules/soleil/compute";
import type { ReglementaireResult } from "../modules/reglementaire/compute";
import type { MobilitesResult } from "../modules/mobilites/compute";

export interface SyntheseInput {
  climat?: ClimatResult;
  vent?: VentResult;
  eau?: EauResult;
  nature?: NatureResult;
  urbanisme?: UrbanismeResult;
  soleil?: SoleilResult;
  reglementaire?: ReglementaireResult;
  mobilites?: MobilitesResult;
}

export interface Signal {
  /** Ce que dit le signal, ex. "Nuits tropicales projetées en forte hausse". */
  label: string;
  /** La valeur qui le fonde, ex. "+18 j/an à l'horizon 2050". */
  valeur: string;
  /** Module d'origine (traçabilité). */
  moduleId: string;
  poids: 1 | 2;
}

export type NiveauEnjeu = "Déterminant" | "Important" | "À surveiller";

export interface Enjeu {
  id: string;
  titre: string;
  niveau: NiveauEnjeu;
  score: number;
  signaux: Signal[];
  /** Signaux qui n'ont pas pu être évalués (module absent/échec). */
  nonEvalues: string[];
  /** Pistes de conception génériques, à arbitrer par le praticien. */
  leviers: string[];
}

export interface SyntheseResult {
  /** Enjeux déclenchés (score > 0), triés par score décroissant. */
  enjeux: Enjeu[];
  /** Règles entièrement inévaluables (aucune donnée disponible). */
  reglesNonEvaluables: string[];
}

// --- Seuils (constantes explicites, toutes commentées) -----------------------
// Surchauffe
const NUITS_TROP_IMPORTANT = 10; // nuits tropicales/an actuelles : seuil de vigilance
const NUITS_TROP_FORT = 25; //     ... seuil critique (littoral méditerranéen dense)
const DELTA_NUITS_2050_MODERE = 5; // hausse projetée (j/an) notable
const DELTA_NUITS_2050_FORT = 15; //  hausse projetée forte
const JOURS_35_2050 = 10; // jours ≥35 °C/an projetés : chaleur extrême récurrente
const SVF_CANYON = 0.35; // seuils SVF alignés sur svfLabel (module Soleil)
const SVF_ENCAISSE = 0.6;
const CANOPEE_FAIBLE_PCT = 10;
const VEGETAL_FAIBLE_PCT = 20;
const CES_DENSE_PCT = 40; // même seuil que l'indice îlot de chaleur d'Urbanisme
// Solaire
const MASQUE_FORT_PCT = 30; // perte d'ensoleillement par masques : forte contrainte
const MASQUE_NOTABLE_PCT = 15;
const PV_FAVORABLE_KWH = 1200; // kWh/an par kWc : gisement solaire favorable (sud de la France)
const DJU_CHAUFFAGE_ELEVE = 2400; // besoin de chauffage élevé : solaire passif précieux
// Eau
const NAPPE_AFFLEURANTE_M = 3; // nappe < 3 m : infiltration/sous-sol contraints
const PLUIE_ABONDANTE_MM = 900;
const CATNAT_RECURRENT = 3; // arrêtés CatNat à moins de 1 km
// Vent
const VENT_FORT_MS = 5; // vitesse moyenne du secteur dominant (m/s)
const VENT_NOTABLE_MS = 3.5;
const CALME_RARE_PCT = 10; // <10 % de calmes : site venté en continu
// Mobilités
const DENSITE_CYCLABLE_FAIBLE = 1; // km/km²
// Réglementaire
const SUP_NOMBREUSES = 3;

const SECTEURS_16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO",
];

function niveau(score: number): NiveauEnjeu {
  if (score >= 4) return "Déterminant";
  if (score >= 2) return "Important";
  return "À surveiller";
}

interface RuleDraft {
  signaux: Signal[];
  nonEvalues: string[];
}

function s(draft: RuleDraft, moduleId: string, poids: 1 | 2, label: string, valeur: string): void {
  draft.signaux.push({ label, valeur, moduleId, poids });
}

function horizon2050(climat?: ClimatResult) {
  if (!climat || climat.projections.length === 0) return null;
  return climat.projections.find((p) => p.id === "2050") ?? climat.projections[climat.projections.length - 1];
}

// --- Règles -------------------------------------------------------------------

function regleSurchauffe(i: SyntheseInput): Enjeu {
  const d: RuleDraft = { signaux: [], nonEvalues: [] };

  if (i.climat) {
    if (i.climat.nuitsTropicales >= NUITS_TROP_FORT)
      s(d, "climat", 2, "Nuits tropicales déjà très fréquentes", `${i.climat.nuitsTropicales} j/an (réf. 1991-2020)`);
    else if (i.climat.nuitsTropicales >= NUITS_TROP_IMPORTANT)
      s(d, "climat", 1, "Nuits tropicales fréquentes", `${i.climat.nuitsTropicales} j/an (réf. 1991-2020)`);

    const h = horizon2050(i.climat);
    if (h) {
      if (h.deltaNuitsTropicales >= DELTA_NUITS_2050_FORT)
        s(d, "climat", 2, "Forte hausse projetée des nuits tropicales", `+${h.deltaNuitsTropicales} j/an (${h.label})`);
      else if (h.deltaNuitsTropicales >= DELTA_NUITS_2050_MODERE)
        s(d, "climat", 1, "Hausse projetée des nuits tropicales", `+${h.deltaNuitsTropicales} j/an (${h.label})`);
      if (h.indicators.joursChaleur35 >= JOURS_35_2050)
        s(d, "climat", 1, "Chaleur extrême récurrente projetée", `${h.indicators.joursChaleur35} j ≥ 35 °C/an (${h.label})`);
    } else {
      d.nonEvalues.push("Projections climatiques indisponibles");
    }
  } else d.nonEvalues.push("Module Climat non disponible");

  if (i.soleil) {
    if (i.soleil.svf < SVF_CANYON)
      s(d, "soleil", 2, "Morphologie en rue canyon (piégeage de chaleur)", `SVF ${i.soleil.svf}`);
    else if (i.soleil.svf < SVF_ENCAISSE)
      s(d, "soleil", 1, "Tissu semi-encaissé", `SVF ${i.soleil.svf}`);
  } else d.nonEvalues.push("SVF non disponible (module Soleil)");

  if (i.nature) {
    if (i.nature.canopyPct < CANOPEE_FAIBLE_PCT)
      s(d, "nature", 1, "Canopée faible (peu d'ombrage naturel)", `${i.nature.canopyPct} % du rayon analysé`);
    if (i.nature.greenPct < VEGETAL_FAIBLE_PCT)
      s(d, "nature", 1, "Végétalisation faible (peu d'évapotranspiration)", `${i.nature.greenPct} %`);
  } else d.nonEvalues.push("Végétalisation non disponible (module Nature)");

  // NB : on utilise le CES directement, PAS l'indice îlot de chaleur
  // d'Urbanisme (qui combine déjà CES + hauteur) — éviter le double comptage.
  if (i.urbanisme) {
    if (i.urbanisme.cesPct > CES_DENSE_PCT)
      s(d, "urbanisme", 1, "Tissu dense et minéral", `CES ${i.urbanisme.cesPct} %`);
  } else d.nonEvalues.push("CES non disponible (module Urbanisme)");

  const score = d.signaux.reduce((a, b) => a + b.poids, 0);
  return {
    id: "surchauffe",
    titre: "Surchauffe estivale & îlot de chaleur",
    niveau: niveau(score),
    score,
    signaux: d.signaux,
    nonEvalues: d.nonEvalues,
    leviers: [
      "Renforcer canopée et végétalisation (ombrage, évapotranspiration)",
      "Désimperméabiliser ; surfaces claires / albédo élevé",
      "Ventilation naturelle traversante et surventilation nocturne",
      "Protections solaires extérieures ; inertie thermique",
    ],
  };
}

function regleSolaire(i: SyntheseInput): Enjeu {
  const d: RuleDraft = { signaux: [], nonEvalues: [] };

  if (i.soleil) {
    if (i.soleil.maskLossPct > MASQUE_FORT_PCT)
      s(d, "soleil", 2, "Masques bâtis très pénalisants", `-${i.soleil.maskLossPct} % d'ensoleillement annuel`);
    else if (i.soleil.maskLossPct > MASQUE_NOTABLE_PCT)
      s(d, "soleil", 1, "Masques bâtis notables", `-${i.soleil.maskLossPct} %`);
    if (i.soleil.pv?.annualKwhPerKwc != null && i.soleil.pv.annualKwhPerKwc >= PV_FAVORABLE_KWH)
      s(d, "soleil", 1, "Gisement photovoltaïque favorable (opportunité)", `${Math.round(i.soleil.pv.annualKwhPerKwc)} kWh/an par kWc`);
  } else d.nonEvalues.push("Masques et PV non disponibles (module Soleil)");

  if (i.climat) {
    if (i.climat.djuChauffage > DJU_CHAUFFAGE_ELEVE)
      s(d, "climat", 1, "Besoin de chauffage élevé : apports solaires passifs précieux", `DJU ${i.climat.djuChauffage}`);
  } else d.nonEvalues.push("DJU non disponibles (module Climat)");

  const score = d.signaux.reduce((a, b) => a + b.poids, 0);
  return {
    id: "solaire",
    titre: "Accès solaire & potentiel énergétique",
    niveau: niveau(score),
    score,
    signaux: d.signaux,
    nonEvalues: d.nonEvalues,
    leviers: [
      "Implantation/orientation tenant compte des masques réels (cf. héliodon)",
      "Pièces de vie et vitrages principaux côté dégagé ; vitrages différenciés",
      "Étudier le PV en toiture si le gisement le justifie",
    ],
  };
}

function regleEauPluviale(i: SyntheseInput): Enjeu {
  const d: RuleDraft = { signaux: [], nonEvalues: [] };

  if (i.reglementaire) {
    if (i.reglementaire.risquesDisponibles) {
      if (i.reglementaire.risquesPresents.some((r) => /inond/i.test(r.libelle)))
        s(d, "reglementaire", 2, "Risque inondation signalé (Géorisques)", "présent sur le point");
      if (i.reglementaire.catnatCount >= CATNAT_RECURRENT)
        s(d, "reglementaire", 1, "Sinistralité CatNat récurrente à proximité", `${i.reglementaire.catnatCount} arrêtés (< 1 km)`);
    } else d.nonEvalues.push("Synthèse risques Géorisques indisponible");
  } else d.nonEvalues.push("Module Réglementaire non disponible");

  if (i.eau) {
    if (i.eau.piezo?.profondeurNappeM != null && i.eau.piezo.profondeurNappeM < NAPPE_AFFLEURANTE_M)
      s(d, "eau", 1, "Nappe potentiellement proche de la surface",
        `${i.eau.piezo.profondeurNappeM.toFixed(1)} m (piézomètre à ${(i.eau.piezo.distanceM / 1000).toFixed(1)} km — indicatif)`);
    if (i.eau.annualPrecipMm > PLUIE_ABONDANTE_MM)
      s(d, "eau", 1, "Pluviométrie abondante", `${i.eau.annualPrecipMm} mm/an`);
  } else d.nonEvalues.push("Module Eau non disponible");

  if (i.nature) {
    if (i.nature.greenPct < VEGETAL_FAIBLE_PCT)
      s(d, "nature", 1, "Sols majoritairement imperméabilisés (ruissellement)", `${i.nature.greenPct} % végétalisé`);
  } else d.nonEvalues.push("Végétalisation non disponible (module Nature)");

  const score = d.signaux.reduce((a, b) => a + b.poids, 0);
  return {
    id: "eau-pluviale",
    titre: "Gestion de l'eau pluviale & risque d'inondation",
    niveau: niveau(score),
    score,
    signaux: d.signaux,
    nonEvalues: d.nonEvalues,
    leviers: [
      "Gestion à la parcelle : infiltration si nappe et sols le permettent, sinon rétention (noues, toitures stockantes)",
      "Désimperméabilisation des sols",
      "Récupération d'eau pluviale (cf. volume estimé, module Eau)",
    ],
  };
}

function regleSols(i: SyntheseInput): Enjeu {
  const d: RuleDraft = { signaux: [], nonEvalues: [] };

  if (i.reglementaire) {
    const rga = i.reglementaire.rgaExposition;
    if (rga && /fort/i.test(rga))
      s(d, "reglementaire", 2, "Exposition forte au retrait-gonflement des argiles", rga);
    else if (rga && /moyen/i.test(rga))
      s(d, "reglementaire", 1, "Exposition moyenne au retrait-gonflement des argiles", rga);
    else if (!rga) d.nonEvalues.push("Exposition RGA indisponible");

    if (i.reglementaire.risquesDisponibles) {
      const geotechnique = i.reglementaire.risquesPresents.filter((r) =>
        /cavit|mouvement de terrain|séism|seism/i.test(r.libelle),
      );
      for (const r of geotechnique.slice(0, 2))
        s(d, "reglementaire", 1, "Aléa géotechnique signalé", r.libelle);
    }
  } else d.nonEvalues.push("Module Réglementaire non disponible");

  const score = d.signaux.reduce((a, b) => a + b.poids, 0);
  return {
    id: "sols",
    titre: "Sols & fondations",
    niveau: niveau(score),
    score,
    signaux: d.signaux,
    nonEvalues: d.nonEvalues,
    leviers: [
      "Étude géotechnique G1/G2 (obligatoire en zone RGA moyenne/forte, loi ÉLAN)",
      "En zone RGA : distance plantations/bâti, gestion des eaux au pied des fondations",
    ],
  };
}

function regleVent(i: SyntheseInput): Enjeu {
  const d: RuleDraft = { signaux: [], nonEvalues: [] };

  if (i.vent) {
    const a = i.vent.annual;
    const vDom = a.meanSpeed[a.dominantSector];
    const dir = SECTEURS_16[a.dominantSector] ?? "?";
    if (vDom >= VENT_FORT_MS)
      s(d, "vent", 2, "Vent dominant soutenu", `${vDom.toFixed(1)} m/s en moyenne, secteur ${dir}`);
    else if (vDom >= VENT_NOTABLE_MS)
      s(d, "vent", 1, "Vent dominant notable", `${vDom.toFixed(1)} m/s, secteur ${dir}`);
    if (a.calmPct < CALME_RARE_PCT)
      s(d, "vent", 1, "Peu de périodes calmes (site venté en continu)", `${a.calmPct} % de calmes`);
  } else d.nonEvalues.push("Module Vent non disponible");

  const score = d.signaux.reduce((a, b) => a + b.poids, 0);
  return {
    id: "vent",
    titre: "Exposition au vent & confort extérieur",
    niveau: niveau(score),
    score,
    signaux: d.signaux,
    nonEvalues: d.nonEvalues,
    leviers: [
      "Implantation et volumétrie protégeant les espaces extérieurs du secteur dominant",
      "Haies brise-vent, sas d'entrée orientés, loggias plutôt que balcons exposés",
      "Valoriser le vent d'été pour la ventilation naturelle (cf. roses saisonnières)",
    ],
  };
}

function regleBiodiversite(i: SyntheseInput): Enjeu {
  const d: RuleDraft = { signaux: [], nonEvalues: [] };

  if (i.nature) {
    if (!i.nature.protectedZonesFetchFailed) {
      const natura = i.nature.protectedZones.filter((z) => /natura/i.test(z.label));
      const znieff = i.nature.protectedZones.filter((z) => /znieff/i.test(z.label));
      const autres = i.nature.protectedZones.filter((z) => !/natura|znieff/i.test(z.label));
      if (natura.length > 0)
        s(d, "nature", 2, "Site en zone Natura 2000 (évaluation des incidences requise)",
          natura.map((z) => z.siteName ?? z.label).join(", "));
      if (znieff.length > 0)
        s(d, "nature", 1, "Site en ZNIEFF (inventaire de richesse écologique)",
          znieff.map((z) => z.siteName ?? z.label).join(", "));
      for (const z of autres.slice(0, 2)) s(d, "nature", 1, z.label, z.siteName ?? "présent");
    } else d.nonEvalues.push("Zonages de protection non vérifiés (service indisponible)");

    if (i.nature.canopyPct >= 25)
      s(d, "nature", 1, "Patrimoine végétal significatif à préserver", `${i.nature.canopyPct} % de canopée`);
  } else d.nonEvalues.push("Module Nature non disponible");

  const score = d.signaux.reduce((a, b) => a + b.poids, 0);
  return {
    id: "biodiversite",
    titre: "Biodiversité & protections environnementales",
    niveau: niveau(score),
    score,
    signaux: d.signaux,
    nonEvalues: d.nonEvalues,
    leviers: [
      "Séquence éviter-réduire-compenser dès l'esquisse",
      "En Natura 2000 : anticiper l'évaluation des incidences",
      "Préserver les sujets arborés existants (plan de gestion, protection en chantier)",
    ],
  };
}

function regleReglementaire(i: SyntheseInput): Enjeu {
  const d: RuleDraft = { signaux: [], nonEvalues: [] };

  if (i.reglementaire) {
    const r = i.reglementaire;
    if (r.isRnu) s(d, "reglementaire", 1, "Commune au RNU (pas de PLU publié)", "règles nationales + consultation mairie indispensable");
    if (r.zonageType === "N" || r.zonageType === "A")
      s(d, "reglementaire", 2, "Zone naturelle ou agricole : constructibilité très restreinte", `zone ${r.zonageLibelle ?? r.zonageType}`);
    else if (r.zonageType && r.zonageType.startsWith("AU"))
      s(d, "reglementaire", 1, "Zone à urbaniser (extension : enjeu ZAN, conditions d'ouverture)", `zone ${r.zonageLibelle ?? r.zonageType}`);
    if (r.supCount >= SUP_NOMBREUSES)
      s(d, "reglementaire", 2, "Servitudes d'utilité publique multiples", `${r.supCount} SUP sur le point`);
    else if (r.supCount >= 1)
      s(d, "reglementaire", 1, "Servitude(s) d'utilité publique", `${r.supCount} SUP`);
  } else d.nonEvalues.push("Module Réglementaire non disponible");

  const score = d.signaux.reduce((a, b) => a + b.poids, 0);
  return {
    id: "reglementaire",
    titre: "Cadre réglementaire & faisabilité",
    niveau: niveau(score),
    score,
    signaux: d.signaux,
    nonEvalues: d.nonEvalues,
    leviers: [
      "Lire le règlement de zone (lien dans le module Réglementaire) avant toute esquisse",
      "Intégrer les SUP dès l'implantation ; consulter la mairie en amont",
    ],
  };
}

function regleMobilites(i: SyntheseInput): Enjeu {
  const d: RuleDraft = { signaux: [], nonEvalues: [] };

  if (i.mobilites && !i.mobilites.fetchFailed) {
    const m = i.mobilites;
    const totalStops = Object.values(m.transitStopsByMode).reduce((a, b) => a + b, 0);
    if (totalStops === 0)
      s(d, "mobilites", 2, "Aucun arrêt de transport en commun dans le rayon", "dépendance automobile probable");
    if (m.cyclingDensityKmKm2 < DENSITE_CYCLABLE_FAIBLE)
      s(d, "mobilites", 1, "Infrastructure cyclable très faible", `${m.cyclingDensityKmKm2} km/km²`);
  } else d.nonEvalues.push("Module Mobilités non disponible");

  const score = d.signaux.reduce((a, b) => a + b.poids, 0);
  return {
    id: "mobilites",
    titre: "Mobilité décarbonée & dépendance automobile",
    niveau: niveau(score),
    score,
    signaux: d.signaux,
    nonEvalues: d.nonEvalues,
    leviers: [
      "Locaux vélo généreux et accessibles ; mutualisation du stationnement",
      "Valoriser la proximité TC existante dans la programmation",
    ],
  };
}

// --- Assemblage ----------------------------------------------------------------

const REGLES = [
  regleSurchauffe,
  regleSolaire,
  regleEauPluviale,
  regleSols,
  regleVent,
  regleBiodiversite,
  regleReglementaire,
  regleMobilites,
];

export function computeSynthese(input: SyntheseInput): SyntheseResult {
  const evaluations = REGLES.map((r) => r(input));

  const enjeux = evaluations
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);

  const reglesNonEvaluables = evaluations
    .filter((e) => e.score === 0 && e.signaux.length === 0 && e.nonEvalues.length > 0)
    .map((e) => `${e.titre} (${e.nonEvalues.join(" ; ")})`);

  return { enjeux, reglesNonEvaluables };
}
