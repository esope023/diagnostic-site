// Héliodon 3D — isolé dans son propre module, comme prévu dès le scaffold
// initial. Aucune autre partie du code ne dépend de Three.js : si on veut
// remplacer/retirer la visualisation 3D un jour, ce fichier suffit.
//
// Simplification assumée : chaque bâtiment est représenté par la boîte
// englobante (bounding box) de son emprise, pas par son polygone exact
// extrudé. Suffisant pour une lecture d'ambiance des masques, pas pour une
// maquette précise.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SiteContext } from "../../core/types";
import type { BuildingFootprint } from "../../core/osm-buildings";
import type { LatLon } from "../../core/geo";
import { REFERENCE_DAYS } from "./solar-position";
import { declinationDeg, elevationDeg, azimuthDeg, sunriseHourAngleDeg } from "./solar-position";
import { ignWmsOrthoImage } from "../../api/endpoints";

const SUN_PATH_RADIUS = 80; // rayon (m, échelle scène) de l'arc solaire affiché
const HA_STEP_DEG = 4;
const GROUND_SIZE_M = 400; // doit rester cohérent avec la PlaneGeometry/GridHelper ci-dessous
/** Hauteur générique d'arbre pour le repère visuel — OSM ne fournit quasiment
 * jamais de hauteur d'arbre mesurée. Illustratif, pas une donnée réelle. */
const GENERIC_TREE_HEIGHT_M = 6;
/** Plafond de rendu (pas de donnée) : au-delà, on sous-échantillonne pour
 * garder la scène 3D fluide sur un rayon large (ex. 1000 m en zone arborée). */
const MAX_TREES_RENDERED = 300;

/** Projette lat/lon en mètres locaux, centré sur le site (même logique que geo.ts). */
function toLocalXY(lat: number, lon: number, refLat: number, refLon: number) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((refLat * Math.PI) / 180);
  return { x: (lon - refLon) * mPerDegLon, z: -(lat - refLat) * mPerDegLat };
}

function buildingMesh(
  b: BuildingFootprint,
  ctx: SiteContext,
  defaultHeight: number,
): THREE.Mesh {
  const pts = b.polygon.map((p) => toLocalXY(p.lat, p.lon, ctx.lat, ctx.lon));
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minZ = Math.min(...pts.map((p) => p.z));
  const maxZ = Math.max(...pts.map((p) => p.z));
  const height = b.heightM ?? defaultHeight;

  const geo = new THREE.BoxGeometry(Math.max(1, maxX - minX), height, Math.max(1, maxZ - minZ));
  const mat = new THREE.MeshStandardMaterial({ color: 0xb0bfc6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((minX + maxX) / 2, height / 2, (minZ + maxZ) / 2);
  return mesh;
}

/** Arbre simplifié : tronc (cylindre) + houppier (cône). Repère visuel, pas
 * une modélisation botanique — la hauteur est générique (voir constante). */
function treeMesh(pos: { x: number; z: number }): THREE.Group {
  const group = new THREE.Group();
  const trunkHeight = GENERIC_TREE_HEIGHT_M * 0.35;
  const crownHeight = GENERIC_TREE_HEIGHT_M - trunkHeight;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, trunkHeight, 6),
    new THREE.MeshStandardMaterial({ color: 0x8a6042 }),
  );
  trunk.position.set(pos.x, trunkHeight / 2, pos.z);

  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, crownHeight, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a7c3f }),
  );
  crown.position.set(pos.x, trunkHeight + crownHeight / 2, pos.z);

  group.add(trunk, crown);
  return group;
}

function sunPathLine(latDeg: number, dayOfYear: number, color: number): THREE.Line {
  const decl = declinationDeg(dayOfYear);
  const haMax = sunriseHourAngleDeg(latDeg, decl);
  const points: THREE.Vector3[] = [];

  for (let ha = -haMax; ha <= haMax; ha += HA_STEP_DEG) {
    const elev = elevationDeg(latDeg, decl, ha);
    if (elev <= 0) continue;
    const az = azimuthDeg(latDeg, decl, ha, elev);
    const azRad = (az * Math.PI) / 180;
    const elevRad = (elev * Math.PI) / 180;
    // Conversion azimut/élévation -> coordonnées 3D (Y=vertical, azimut 0=N=-Z, 90=E=+X).
    const r = SUN_PATH_RADIUS * Math.cos(elevRad);
    points.push(
      new THREE.Vector3(r * Math.sin(azRad), SUN_PATH_RADIUS * Math.sin(elevRad), -r * Math.cos(azRad)),
    );
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color });
  return new THREE.Line(geometry, material);
}

export interface HeliodonHandle {
  dispose(): void;
}

/** Monte la scène 3D dans le conteneur fourni. Retourne un handle à disposer au démontage. */
export function mountHeliodon(
  container: HTMLElement,
  buildings: BuildingFootprint[],
  trees: LatLon[],
  ctx: SiteContext,
  defaultHeight: number,
): HeliodonHandle {
  const width = container.clientWidth || 400;
  const height = container.clientHeight || 320;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeaf2f5);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
  camera.position.set(120, 100, 120);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 5, 0);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(50, 80, 50);
  scene.add(sun);

  const groundMat = new THREE.MeshStandardMaterial({ color: 0xdfe6e2 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M), groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  scene.add(new THREE.GridHelper(GROUND_SIZE_M, 40, 0xaaaaaa, 0xcccccc));

  // Photo aérienne IGN en texture de sol (best-effort : en cas d'échec, on
  // garde la couleur plate ci-dessus, aucune dépendance bloquante).
  const orthoUrl = ignWmsOrthoImage(ctx.lat, ctx.lon, GROUND_SIZE_M);
  new THREE.TextureLoader().load(
    orthoUrl,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      groundMat.map = texture;
      groundMat.color.set(0xffffff);
      groundMat.needsUpdate = true;
    },
    undefined,
    () => {
      // silencieux : le sol reste de couleur plate.
    },
  );

  for (const b of buildings) {
    scene.add(buildingMesh(b, ctx, defaultHeight));
  }

  const treesToRender =
    trees.length > MAX_TREES_RENDERED
      ? trees.filter((_, i) => i % Math.ceil(trees.length / MAX_TREES_RENDERED) === 0)
      : trees;
  for (const t of treesToRender) {
    const pos = toLocalXY(t.lat, t.lon, ctx.lat, ctx.lon);
    scene.add(treeMesh(pos));
  }

  const pathColors = [0x2980b9, 0xf39c12, 0xc0392b];
  REFERENCE_DAYS.forEach((d, i) => {
    scene.add(sunPathLine(ctx.lat, d.dayOfYear, pathColors[i % pathColors.length]));
  });

  let frameId = 0;
  function animate() {
    controls.update();
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  }
  animate();

  return {
    dispose() {
      cancelAnimationFrame(frameId);
      controls.dispose();
      renderer.dispose();
      container.innerHTML = "";
    },
  };
}
