// Module Urbanisme — assemble le contrat DiagnosticModule. Scope "quartier".
import type { DiagnosticModule, ExportBlock, SiteContext } from "../../core/types";
import { fetchUrbanisme, type UrbanismeRaw } from "./fetch";
import { computeUrbanisme, ORIENTATION_LABELS, type UrbanismeResult } from "./compute";
import { renderUrbanisme } from "./render";
import { orientationConfig } from "./charts";

export const urbanismeModule: DiagnosticModule<UrbanismeRaw, UrbanismeResult> = {
  id: "urbanisme",
  label: "Urbanisme",
  icon: "🏙",
  scope: "quartier",

  fetchData(ctx: SiteContext) {
    return fetchUrbanisme(ctx);
  },

  compute(raw: UrbanismeRaw, ctx: SiteContext) {
    return computeUrbanisme(raw, ctx);
  },

  render(el: HTMLElement, result: UrbanismeResult) {
    renderUrbanisme(el, result);
  },

  toExport(result: UrbanismeResult): ExportBlock {
    if (result.fetchFailed || result.buildingCount === 0) {
      return {
        moduleId: "urbanisme",
        title: "Urbanisme",
        summary:
          result.buildingCount === 0
            ? `Aucun bâtiment identifié dans OpenStreetMap dans un rayon de ${result.effectiveRadiusM} m.`
            : "Données OpenStreetMap indisponibles au moment de la génération du rapport.",
        indicators: [],
        charts: [],
        notes: [],
      };
    }

    const referenceLabel =
      result.referenceAreaSource === "parcelle_cadastrale"
        ? `parcelle cadastrale${result.parcelleReference ? ` ${result.parcelleReference}` : ""} (${result.referenceAreaM2} m²)`
        : `cercle de ${result.effectiveRadiusM} m (${result.referenceAreaM2} m²)`;

    return {
      moduleId: "urbanisme",
      title: "Urbanisme",
      summary:
        `${result.buildingCount} bâtiments, référence ${referenceLabel} : ` +
        `emprise au sol ${result.cesPct} %, orientation dominante ${ORIENTATION_LABELS[result.dominantOrientation]}. ` +
        `Indice qualitatif d'îlot de chaleur : ${result.risqueIlotChaleur}.`,
      indicators: [
        { label: "Bâtiments recensés", value: `${result.buildingCount}` },
        { label: "Source des hauteurs", value: result.heightSource },
        { label: "Surface de référence", value: referenceLabel },
        { label: "Emprise au sol (CES)", value: `${result.cesPct} %` },
        { label: "COS approximatif", value: `${result.cosApprox}` },
        {
          label: "Hauteur moyenne estimée",
          value: result.meanHeightM !== null ? `${result.meanHeightM} m` : "n.d.",
        },
        { label: "Couverture données hauteur", value: `${result.heightCoveragePct} %` },
        { label: "Orientation dominante", value: ORIENTATION_LABELS[result.dominantOrientation] },
        { label: "Indice îlot de chaleur", value: result.risqueIlotChaleur },
      ],
      charts: [{ title: "Orientation dominante des bâtiments", config: orientationConfig(result) }],
      notes: [
        "Source des bâtiments : IGN BD TOPO® en priorité (hauteur mesurée), repli " +
          "OpenStreetMap si le WFS échoue — même source que le module Soleil.",
        result.referenceAreaSource === "parcelle_cadastrale"
          ? "CES/COS calculés sur la surface cadastrale réelle (IGN PCI) : définition " +
            "réglementaire correcte pour ce cadrage 'Parcelle'."
          : "CES/COS calculés sur un cercle (cadrage 'quartier'), pas sur une parcelle : " +
            "estimation haute, les polygones ne sont pas découpés au bord du rayon.",
        `Hauteur connue pour seulement ${result.heightCoveragePct} % des bâtiments ` +
          "(building:levels × 3 m) : COS et hauteur moyenne à interpréter avec prudence si ce taux est bas.",
        "L'indice d'îlot de chaleur est une heuristique (densité + hauteur), pas une " +
          "simulation UHI. Le confort des espaces publics (vent, ombre piétonne) n'est pas " +
          "calculé : nécessite des données de simulation non disponibles via API publique.",
        "Rappel : le contour cadastral (PCI) est une représentation graphique, pas un " +
          "document juridique — seuls les actes de vente font foi.",
      ],
    };
  },
};
