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

## Synthèse des enjeux (`src/synthese/`)

Moteur de **règles croisées explicites** qui transforme les huit modules
d'un empilement d'indicateurs en un diagnostic hiérarchisé. Affiché en tête
de page (au-dessus de la carte) et en premier bloc du rapport PDF.

Principe, à respecter pour toute règle ajoutée :

- Une règle = une fonction pure (`src/synthese/rules.ts`) qui lit les
  `Result` déjà calculés par les modules (via `getResult()` du registre —
  aucun fetch, aucune dépendance réseau) et produit des **signaux** : un
  signal = un indicateur + un seuil écrit en constante commentée + un poids
  (1 ou 2). Le score de l'enjeu = somme des poids ; le niveau (Déterminant /
  Important / À surveiller) découle du score par des bornes explicites.
- **Chaque signal affiché porte sa valeur et son module d'origine** — le
  praticien peut toujours remonter au chiffre exact qui fonde l'enjeu.
  Aucune pondération cachée, aucun modèle entraîné, aucune magie.
- **Donnée manquante = dit explicitement** ("non évalué : module X non
  disponible"), jamais silencieux et jamais traité comme "risque nul".
- La hiérarchie produite est **indicative** : c'est une aide à la lecture
  croisée, pas un jugement automatique. Le disclaimer est affiché à l'écran
  et répété dans l'export.

Huit règles actuellement câblées : surchauffe/îlot de chaleur, accès
solaire/potentiel énergétique, eau pluviale/inondation, sols/fondations
(RGA), vent/confort extérieur, biodiversité/protections, cadre réglementaire,
mobilité décarbonée. Pour ajouter une règle : écrire une fonction
`(i: SyntheseInput) => Enjeu` dans `rules.ts`, l'ajouter au tableau `REGLES`
en bas du fichier — rien d'autre à toucher (le rendu écran et l'export la
prennent automatiquement en compte).

**Point de vigilance en cas d'évolution d'un module** : les règles lisent
des noms de champs précis sur les `Result` de chaque module (ex.
`i.urbanisme.cesPct`, `i.soleil.svf`). Si un module renomme un champ, le
TypeScript du moteur de règles ne compilera plus — c'est voulu (mieux vaut
une erreur de build qu'une règle qui lit silencieusement `undefined`).

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
| Nature — trame verte/bleue, canopée | quartier | Overpass (OSM) + IGN | ✅ direct | **implémenté** (proxy vert/eau/canopée + zonages protection) |
| Eau — récupération EP | site | emprise toiture (Overpass/OSM) × pluie (Open-Meteo) | ✅ direct | **implémenté** |
| Eau — piézométrie (profondeur nappe) | site | Hub'Eau (BRGM/ADES) | ✅ direct | **implémenté** (indicatif) |
| Eau — infiltration, ruissellement | quartier | sol + imperméabilisation → indice | ✅ direct | qualitatif |
| Urbanisme — compacité, orientations | quartier | emprises OSM (CES/COS/orientation) | ✅ direct | **implémenté** |
| Urbanisme — îlot de fraîcheur, confort ESP | quartier | heuristique densité+hauteur (qualitatif) | ✅ direct | **implémenté** (qualitatif) |
| Réglementaire — zonage PLU, SUP, risques | site | API Carto GPU (IGN) + Géorisques (BRGM) | ✅ direct | **implémenté** |
| Mobilités — cyclable, transport en commun | quartier | Overpass (OSM) | ✅ direct | **implémenté** |

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

## Extension Nature — zonages de protection réglementaires

En plus du proxy OSM (verdure/eau/canopée), le module Nature interroge
maintenant l'**API Carto module Nature** de l'IGN (données INPN/MNHN) pour
détecter les zonages de protection officiels sur le point recherché : Natura
2000 (habitat + oiseaux), ZNIEFF I/II, parcs nationaux/régionaux, réserves
naturelles.

**Incertitude assumée à vérifier au premier test réel** : contrairement aux
autres API de ce projet, je n'ai pas pu confirmer par un appel direct le
segment d'URL exact de chaque couche (`natura-habitat`, `znieff1`, etc. dans
`src/modules/nature/fetch.ts`) ni le nom de la propriété portant le nom du
site (plusieurs candidats testés défensivement : `sitename`, `nom`, `name`…).
Si toutes les couches échouent, le module l'affiche explicitement
("service indisponible") plutôt que d'afficher "aucune protection" — ce serait
le pire des mensonges silencieux pour ce type d'information. Si une commune a
une vraie zone Natura 2000 mais que le module affiche 0, commencer par
vérifier le segment d'URL dans `PROTECTED_LAYERS` (`fetch.ts`).

Vérifié sur le **point précis**, pas sur l'ensemble du rayon "quartier" :
une zone protégée qui commence juste à côté du point recherché n'apparaîtra
pas. Pour une vérification exhaustive dans un rayon, il faudrait interroger
avec un polygone plutôt qu'un point (raffinement possible plus tard).

## Extension Eau — piézométrie (Hub'Eau)

Le module Eau interroge maintenant l'**API Piézométrie de Hub'Eau** (BRGM,
données ADES) pour donner une vraie mesure de profondeur de nappe, plutôt que
l'indice qualitatif laissé en placeholder depuis le début du projet.

Recherche des piézomètres dans un rayon de **15 km** (les piézomètres sont
rares — quelques milliers en France — un rayon serré ne trouverait souvent
rien), garde le plus proche par distance réelle, puis récupère sa dernière
mesure de profondeur de nappe. **Ce n'est jamais une mesure sur site** : la
distance au piézomètre le plus proche est affichée à chaque fois, pour que la
donnée soit lue comme indicative (première lecture infiltration/fondations),
pas comme une étude géotechnique.

## Module Réseaux (chaleur urbaine) — non implémenté, accès API à clarifier

L'intégration de **France Chaleur Urbaine** (réseaux de chaleur/froid) prévue
dans la feuille de route n'a pas été codée : leur dépôt GitHub mentionne une
étape "récupérer les API Keys", ce qui suggère un accès nécessitant une
inscription — contrairement à toutes les autres sources de ce projet
(zéro configuration, appel direct navigateur). Je n'ai pas voulu écrire du
code sur une hypothèse d'accès non vérifiée. À investiguer : contacter
France Chaleur Urbaine pour confirmer les modalités d'accès à leur API
publique, ou se limiter à afficher un lien vers leur outil externe
(`france-chaleur-urbaine.beta.gouv.fr`) plutôt qu'une intégration native.

## Module Mobilités

`src/modules/mobilites/` — infrastructure cyclable (aménagée/partagée/en
projet) et transport en commun (arrêts + lignes). Scope `"quartier"`, rayon
minimal de 300 m en cadrage Parcelle (l'infra cyclable/TC n'a de sens qu'à
l'échelle du voisinage).

- **Cyclable** : Overpass, classification aménagée (piste/site propre) vs
  partagée (bande, voie mixte) vs en projet. Densité calculée (km/km²) comme
  indicateur réel, pas un indice qualitatif inventé.
- **Transport en commun** : arrêts (bus/tram/métro-train) et lignes (nom,
  numéro) via les relations OSM `route=*`. Les tracés précis des lignes ne
  sont pas affichés (seuls arrêts + identité de ligne), pour rester léger.
- **Strava exclu volontairement** : la heatmap globale exige un compte
  connecté et ses CGU interdisent la réutilisation hors de leurs produits ;
  les données individuelles demandent un OAuth par utilisateur ; Strava Metro
  est réservé aux collectivités partenaires. Rien d'intégrable proprement
  dans un outil diffusé.
- **Limite assumée sur "en projet"** : contrairement au reste du projet, il
  n'existe pas de source nationale unifiée pour les tracés cyclables en
  projet des métropoles françaises. La catégorie dépend entièrement du
  remplissage communautaire OSM — une absence ne signifie pas qu'aucun projet
  n'existe.

## Module Réglementaire

`src/modules/reglementaire/` — zonage PLU, lien vers le règlement, servitudes
d'utilité publique, exposition RGA, synthèse des risques et historique
catastrophes naturelles. Scope `"site"` (propre au point/parcelle, indépendant
du rayon "quartier").

Sources et points d'attention :

- **Zonage PLU** : API Carto GPU (`apicarto.ign.fr/api/gpu/zone-urba`),
  géométrie envoyée en `Point` (pas la parcelle complète — à noter si une
  parcelle est à cheval sur deux zones). Détecte aussi le RNU (`gpu/municipality`)
  quand la commune n'a pas de PLU publié.
- **Lien vers le règlement** : API du Géoportail de l'Urbanisme
  (`geoportail-urbanisme.gouv.fr/api/document/{partition}/details`), qui
  renvoie l'archive et les fichiers PDF du document.
- **SUP** : trois couches API Carto GPU (`assiette-sup-s/l/p`), combinées.
  Couverture GPU incomplète (~20 % des communes, surtout rurales) : une
  absence de résultat ne garantit pas l'absence réelle de servitude.
- **RGA** (retrait-gonflement des argiles) : endpoint dédié Géorisques
  (`/api/v1/rga`), le plus fiable des endpoints Géorisques utilisés ici.
- **Synthèse multi-risques** : endpoint `/api/v1/resultats_rapport_risque`,
  qui a l'avantage de tout donner en un appel mais dont des utilisateurs tiers
  ont signalé une instabilité intermittente. Traité **très défensivement**
  (`RisqueSyntheseRaw` dans `fetch.ts`) : le module affiche "indisponible"
  plutôt que de planter ou d'inventer une structure de réponse.
- **Historique CatNat** : `/api/v1/gaspar/catnat`, rayon 1 km autour du point.

Toutes les requêtes sont indépendantes (`Promise.all` sur des fonctions qui
catchent chacune leurs propres erreurs) : l'échec d'une source n'empêche pas
d'afficher les autres.

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
