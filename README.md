# Diagnostic de site — outil bioclimatique modulaire

Outil front léger (Vite + TypeScript) qui diagnostique un site à partir d'API
publiques : climat, soleil, vent, nature, eau, urbanisme. Chaque thème est un
**module** autonome respectant un contrat unique, et l'export PDF s'assemble
automatiquement à partir des modules actifs.

Ce README fait aussi office de **spec** : il décrit l'architecture, la façon
d'ajouter un module, et la feuille de route. Un agent (Claude Code) peut s'en
servir pour répliquer le patron.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # bundle statique dans dist/
npm run typecheck
```

## Architecture

Deux abstractions portent tout le reste :

- **`SiteContext`** (`src/core/types.ts`) : le site géocodé (lat, lon, altitude,
  commune, fuseau…), construit une seule fois (`src/core/site-context.ts`).
  Tous les modules le consomment, rien d'autre.
- **`DiagnosticModule`** (`src/core/types.ts`) : le contrat que respecte chaque
  thème. Quatre méthodes : `fetchData → compute → render` et `toExport`.

Autour :

| Rôle | Fichier |
|------|---------|
| Client API (cache IndexedDB, retry, timeout, erreurs) | `src/api/client.ts` |
| Cache persistant | `src/api/cache.ts` |
| URLs des API + gestion CORS/proxy | `src/api/endpoints.ts` |
| Géométrie partagée (aire, azimut, point-dans-polygone, distance) | `src/core/geo.ts` |
| Géocodage BAN | `src/core/geocode.ts` |
| Registre + exécution des modules | `src/core/module-registry.ts` |
| Carte Leaflet + WMTS IGN | `src/map/map.ts` |
| Export PDF | `src/export/report.ts` |
| Câblage UI | `src/main.ts` |

Flux : `main.ts` géocode → construit le `SiteContext` (avec le rayon choisi) →
pour chaque module enregistré, `runModule` fait `fetchData → compute → render`
et mémorise le résultat → l'export itère sur les `toExport()`.

## Périmètre d'analyse : "site" vs "quartier"

Beaucoup d'études se font à l'échelle du quartier, pas seulement de la
parcelle. Un sélecteur de rayon (`Parcelle`, `100 m`, `300 m`, `600 m`,
`1000 m` — défini dans `src/core/scope.ts`) est disponible dans l'en-tête.
Changer le rayon **ne relance pas tout le diagnostic** : seuls les modules qui
en dépendent sont recalculés.

Chaque module déclare sa **portée** (`scope`, champ obligatoire du contrat) :

- **`"site"`** — indépendant du rayon. Concerne les données de grille
  (Climat, Vent — la résolution des modèles est de toute façon de l'ordre du
  km, un rayon de 100 m ou 1000 m ne change rien) et les données propres au
  bâtiment (Eau — le potentiel de récupération dépend de *cette* toiture,
  pas du quartier).
- **`"quartier"`** — dépend de `ctx.radiusM`. Concerne la morphologie
  environnante : Nature (trame verte/bleue, canopée), Urbanisme (compacité,
  îlot de fraîcheur), et la partie masques du module Soleil. Ces modules
  doivent utiliser `ctx.radiusM` dans leurs requêtes (ex. Overpass
  `around:${ctx.radiusM}`) plutôt qu'un rayon codé en dur.

`radiusM` vaut `null` pour le préréglage **Parcelle** : pas de cercle affiché,
granularité bâtiment. Pour l'instant les modules "parcelle" retombent sur le
bâtiment du site (cf. `pickBuilding` dans le module Eau) ; le vrai contour
cadastral (PCI Express / cadastre IGN) est un raffinement futur, pas encore
branché.

Nouveau module "quartier" : reprendre le patron du module Nature (premier
module à consommer `ctx.radiusM`) pour l'appel Overpass — `around:${ctx.radiusM
?? FALLBACK}` — et `scope: "quartier"` dans `index.ts`. Le module Nature
assume une limite documentée : Overpass ne découpe pas les polygones au bord
du rayon (surfaces = borne haute, pas une mesure exacte). Reproduire cette
transparence plutôt que de la corriger silencieusement avec des heuristiques
approximatives.


## Ajouter un module (patron)

Le module **Climat** (`src/modules/climat/`) est le gabarit de référence.
Pour créer `soleil`, `vent`, `eau`… :

1. Copier `src/modules/climat/` vers `src/modules/<nom>/`.
2. Remplacer :
   - `fetch.ts` — appels API (toujours via `fetchJson` du client).
   - `compute.ts` — transformation pure en indicateurs (pas d'I/O, testable).
   - `charts.ts` — configs Chart.js partagées écran/export.
   - `render.ts` — rendu DOM.
   - `index.ts` — assemble le contrat `DiagnosticModule`.
3. Enregistrer dans `src/main.ts` : `registerModule(<nom>Module)`.

Rien d'autre à modifier : l'UI et l'export prennent le nouveau module en compte
automatiquement.

## Sources de données par module

| Module | Portée | API / source | CORS navigateur | Statut |
|--------|--------|--------------|-----------------|--------|
| Climat (normales, DJU, ET₀, rayonnement, nuits trop., canicule) | site | Open-Meteo Archive (ERA5) | ✅ direct | **implémenté** |
| Climat — scénarios 2030/2050 | site | Open-Meteo Climate API (CMIP6, 3 modèles) | ✅ direct | **implémenté** |
| Cadastre — vraie parcelle (surface, référence) | site | IGN WFS PCI Express | ✅ direct | **implémenté** |
| Soleil — diagramme, masques, ombres, ensoleillement | quartier | géométrie solaire pure + IGN BD TOPO (repli OSM) + Three.js | ✅ (WFS/tuiles) | **implémenté** |
| Soleil — potentiel PV / solaire thermique | quartier | PVGIS 5.3 | ❌ **proxy requis** | **implémenté** (si proxy déployé) |
| Vent — roses saisonnières | site | Open-Meteo (dir./vitesse horaires, 10 ans) | ✅ direct | **implémenté** |
| Vent — accélérations, canyon, confort piéton | quartier | *aucune API* → indice qualitatif (Lawson) | — | qualitatif |
| Nature — trame verte/bleue, canopée | quartier | Overpass (OSM) + IGN | ✅ direct | **implémenté** (proxy vert/eau/canopée) |
| Eau — récupération EP | site | emprise toiture (Overpass/OSM) × pluie (Open-Meteo) | ✅ direct | **implémenté** |
| Eau — infiltration, ruissellement | quartier | sol + imperméabilisation → indice | ✅ direct | qualitatif |
| Urbanisme — compacité, orientations | quartier | emprises OSM (CES/COS/orientation) | ✅ direct | **implémenté** |
| Urbanisme — îlot de fraîcheur, confort ESP | quartier | heuristique densité+hauteur (qualitatif) | ✅ direct | **implémenté** (qualitatif) |

### Trois familles, à traiter dans cet ordre

1. **API → calcul → graphe** (climat, roses de vent, EP…) : faisable en pur
   front, ROI immédiat. **Commencer ici.**
2. **Géométrie 3D réelle** (soleil, masques, ombres) : déterministe, plus de
   travail, module Three.js isolé.
3. **Indices qualitatifs** (canyon vent, îlot de fraîcheur, hydrologie fine) :
   aucune API ne les calcule ; les afficher **explicitement** comme estimations.

## Proxy PVGIS (CORS)

PVGIS refuse les appels AJAX depuis un navigateur. Pour le module PV, déployer
le proxy `worker/pvgis-proxy.js` sur Cloudflare Workers (gratuit) :

```bash
npm i -g wrangler && wrangler login
wrangler deploy worker/pvgis-proxy.js --name diagnostic-proxy
```

Puis renseigner `VITE_PROXY_BASE` dans `.env` (voir `.env.example`). Le proxy a
une allowlist d'hôtes : ce n'est pas un proxy ouvert.

## Déploiement GitHub Pages

`.github/workflows/deploy.yml` build et publie `dist/` à chaque push sur `main`.
Le `base` Vite est réglé sur `/<nom-du-repo>/` via `GH_PAGES_BASE`. Activer
Pages sur la source « GitHub Actions » dans les réglages du repo.

## Choix techniques

- **Vite + TypeScript** : typage des réponses d'API = moins de bugs silencieux
  avec autant de sources différentes.
- **Leaflet + WMTS IGN** (`data.geopf.fr`, libre, sans clé) : léger. Passer à
  MapLibre GL seulement si besoin de vectoriel/3D.
- **Chart.js** : suffisant, y compris pour les **roses des vents** — utilisé en
  mode `polarArea` (16 secteurs, couleur = vitesse moyenne). C'est une
  approximation lisible mais pas une rose météo normée à classes de vitesse
  empilées ; passer à ECharts si ce niveau de précision devient nécessaire.
- **Cache IndexedDB** : Overpass et les WFS sont lents ; on ne retélécharge pas
  deux fois la même dalle.

## Projections climatiques (module Climat)

Deux horizons calculés à partir d'Open-Meteo Climate API (CMIP6) :
**2021-2035** ("horizon 2030") et **2036-2050** ("horizon 2050" — c'est la fin
de la période disponible dans l'API, pas une valeur ponctuelle à cette date).

Choix techniques à connaître :

- **Une requête par modèle**, pas une requête multi-modèles. Le format de
  réponse JSON d'Open-Meteo change quand plusieurs modèles sont demandés
  ensemble (suffixage des clés) ; plutôt que de deviner cette convention sans
  pouvoir la vérifier en direct, le code fait 3 requêtes simples à réponse
  standard et moyenne les indicateurs lui-même (`src/modules/climat/fetch.ts`,
  `compute.ts`).
- **Ensemble simplifié à 3 modèles** (`EC_Earth3P_HR`, `MRI_AGCM3_2_S`,
  `CMCC_CM2_VHR4` — couverture température complète, origines diverses), pas
  les 7 modèles disponibles, pour limiter le volume de données.
- **Aucun choix de scénario d'émission possible** : l'API est calée sur une
  trajectoire proche de RCP8.5 jusqu'en 2050.
- Les indicateurs de projection utilisent **exactement la même fonction**
  (`computeTemperatureIndicators`) que la référence 1991-2020 — condition
  nécessaire pour que les écarts (Δ, %) aient un sens.
- Un pourcentage d'évolution affiché "n.d." signifie une référence à 0 (ex.
  0 nuit tropicale en 1991-2020) : le phénomène apparaîtrait, un % n'est pas
  exploitable dans ce cas.

## Module cadastre (vraie parcelle)

`src/core/cadastre.ts` récupère la parcelle cadastrale réelle (IGN
Parcellaire Express / PCI, WFS Géoplateforme, couche
`CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle`) et l'attache au
`SiteContext` (`ctx.parcelle`), au même titre que l'altitude — récupérée une
fois, pas un module à part.

Utilisations concrètes :

- **Carte** : contour de la parcelle affiché en pointillés orange
  (`src/map/map.ts`), dès qu'un site est chargé.
- **Urbanisme** : quand le cadrage "Parcelle" est actif ET qu'une parcelle a
  été trouvée, le CES/COS sont calculés sur la **surface cadastrale réelle**
  plutôt que sur un cercle arbitraire — c'est la définition réglementaire
  correcte (CES = emprise bâtie / surface de parcelle). L'indicateur "Surface
  de référence" indique toujours laquelle a été utilisée.

Limites assumées :

- Le contour PCI est une **représentation graphique**, pas un document
  juridique — seuls les actes de vente font foi. Rappelé dans l'export.
- Si l'attribut `contenance` (surface légale) est absent de la réponse WFS,
  la surface est recalculée depuis la géométrie (moins fiable) — la source
  utilisée (`surfaceSource`) est conservée pour rester transparent.
- Si le schéma WFS a changé depuis l'écriture de ce code, `fetchParcelle`
  renvoie `null` plutôt qu'une donnée fausse ; Urbanisme retombe alors sur le
  cercle comme avant.

## Source des bâtiments unifiée (IGN BD TOPO® en priorité)

`src/core/buildings.ts` centralise la logique "bâtiments avec hauteur" :
essaie **IGN BD TOPO®** (WFS Géoplateforme, hauteur mesurée) en premier, puis
**replie sur OpenStreetMap** (`src/core/osm-buildings.ts`, hauteur déduite du
tag facultatif `building:levels`) si le WFS échoue ou ne couvre pas la zone.

Utilisé par **Urbanisme** et **Soleil** — avant cette factorisation, seul
Soleil essayait la BD TOPO ; Urbanisme se limitait à OSM. Les deux modules
affichent maintenant l'indicateur "Source des hauteurs" pour qu'on sache
toujours laquelle a été utilisée. Le module Eau reste sur OSM seul (son besoin
est le contour de toiture, pas la hauteur — changement non fait pour rester
concentré sur la demande initiale, mais un candidat naturel si on veut aussi
affiner la précision de contour un jour).

Nouveau module utilisant des bâtiments : importer `fetchBuildingsWithHeight`
depuis `src/core/buildings.ts` plutôt que de refaire un appel Overpass ou WFS
direct.

## Arbres dans l'héliodon 3D (module Soleil)

Le module Soleil récupère aussi les arbres recensés dans OSM
(`natural=tree`) et les affiche dans l'héliodon 3D (tronc + houppier simplifiés,
`src/modules/soleil/heliodon3d.ts`) pour donner un repère spatial.

Points importants :

- **Hauteur générique de 6 m** pour tous les arbres — OSM ne fournit
  quasiment jamais de hauteur d'arbre mesurée. Purement illustratif.
- **Les arbres n'entrent pas dans le calcul du masque solaire** : seuls les
  bâtiments y contribuent. Une hauteur de couronne non mesurée fausserait le
  calcul plus qu'elle ne l'affinerait — mieux vaut l'absence assumée qu'une
  fausse précision.
- **Rendu plafonné à 300 arbres** (sous-échantillonnage si plus, pas de perte
  de donnée ailleurs dans l'outil) pour garder la scène 3D fluide sur un
  rayon large en zone arborée.

## SVF et lien vers l'héliodon historique (module Soleil)

Deux ajouts légers, sans nouvelle dépendance :

- **SVF (facteur de vue du ciel)** — formule d'Oke, calculée à partir du même
  masque bâti que le diagramme de masques (`svfLabel` donne une lecture
  qualitative : ciel dégagé / semi-encaissé / rue canyon). Valeur au point du
  site, pas une carte ; ne tient compte ni du relief ni de la végétation.
- **Lien vers l'héliodon historique** (`heliodon.html` du repo
  `esope023/Analyse`) — extrusion réelle des polygones, ombres portées,
  orthophoto IGN au sol, calque LiDAR HD pour la végétation : bien plus abouti
  visuellement que l'aperçu 3D simplifié intégré (boîtes englobantes, sans
  ombres). Plutôt que dupliquer ce travail, le module Soleil s'y lie avec les
  coordonnées du site en paramètres d'URL. L'URL est configurable via
  `VITE_LEGACY_HELIODON_URL` (`.env`) si le déploiement change.

## Module Soleil — points d'attention spécifiques

Ce module ajoute une dépendance (**Three.js**, pour l'héliodon 3D isolé dans
`src/modules/soleil/heliodon3d.ts`). Après avoir récupéré ces fichiers,
réinstaller :

```bash
npm install
```

Trois choses à savoir avant de l'utiliser en conditions réelles :

1. **Géométrie solaire en temps solaire vrai**, pas en heure civile — voir
   `solar-position.ts`. C'est l'usage classique des diagrammes de masques en
   architecture ; pas de bug de fuseau horaire possible puisqu'aucune
   conversion UTC/civil n'est faite.
2. **Le schéma WFS IGN BD TOPO® est à vérifier au premier test réel.** Le nom
   de couche (`BDTOPO_V3:batiment`) et l'attribut de hauteur (`hauteur`) sont
   ceux publiés au moment de l'écriture (voir `src/api/endpoints.ts`) mais
   peuvent avoir changé. Si le WFS ne renvoie rien d'exploitable, le module
   **bascule automatiquement sur OpenStreetMap** (`src/core/osm-buildings.ts`,
   le même utilitaire que le module Urbanisme) — la source utilisée est
   affichée dans l'indicateur "Source des hauteurs".
3. **Le potentiel PV nécessite le proxy Cloudflare** (`worker/pvgis-proxy.js`)
   pour la même raison que documentée dès le premier scaffold : PVGIS bloque
   les appels AJAX directs. Sans proxy déployé (`VITE_PROXY_BASE` vide), le
   module l'indique clairement plutôt que d'afficher une erreur générique.

Comme les autres modules "quartier", changer le rayon d'analyse relance le
module Soleil (masques recalculés sur les bâtiments du nouveau rayon).

## Licences / attributions (obligatoires sur l'export)

© OpenStreetMap (ODbL) · © IGN / Géoplateforme (Licence Ouverte Etalab 2.0) ·
Open-Meteo (CC BY 4.0) · PVGIS © Union européenne.
