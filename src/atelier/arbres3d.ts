// Arbres en volume dans la vue 3D de l'atelier, dessinés par three.js dans
// une couche personnalisée MapLibre (même tampon de profondeur que les
// bâtiments : un arbre derrière un immeuble est bien masqué).
//
// Esthétique reprise de l'héliodon historique : tronc fin, houppier facetté
// (icosaèdre ou dodécaèdre), tailles, rotations et verts variés. La variation
// est déterministe (tirée de la position de l'arbre) : le même arbre garde la
// même forme d'un affichage à l'autre. Les dimensions renseignées dans
// OpenStreetMap (height, diameter_crown) sont utilisées quand elles existent ;
// sinon la taille est générique, comme le dit le panneau.

import * as THREE from "three";
import maplibregl from "maplibre-gl";
import type { ArbreOsm } from "../modules/soleil/fetch";

const VERTS = [0x2d6b28, 0x3a7a30, 0x4a8a38, 0x1d5620, 0x557f34];
const MAX_ARBRES = 1500;

/** Pseudo-aléa stable dans [0, 1[, tiré des coordonnées. */
function alea(lat: number, lon: number, graine: number): number {
  const x = Math.sin(lat * 12.9898e3 + lon * 78.233e3 + graine * 37.719) * 43758.5453;
  return x - Math.floor(x);
}

export interface CoucheArbres3D extends maplibregl.CustomLayerInterface {
  setArbres(arbres: ArbreOsm[], lat0: number, lon0: number): void;
  setOpacite(o: number): void;
}

export function creerCoucheArbres3D(id: string): CoucheArbres3D {
  let map: maplibregl.Map | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const groupe = new THREE.Group();
  scene.add(groupe);

  // Lumière douce : ciel et sol, plus un soleil rasant du sud-ouest.
  scene.add(new THREE.HemisphereLight(0xdce8f2, 0x4a4436, 1.0));
  const soleil = new THREE.DirectionalLight(0xfff4e0, 1.25);
  soleil.position.set(-60, 120, 80);
  scene.add(soleil);

  const matTronc = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.95, transparent: true });
  const matHouppier = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, transparent: true });
  const geoTronc = new THREE.CylinderGeometry(0.14, 0.22, 1, 7, 1).translate(0, 0.5, 0);
  const geoFeuillus = [new THREE.IcosahedronGeometry(1, 1), new THREE.DodecahedronGeometry(1, 0)];
  const geoResineux = new THREE.ConeGeometry(1, 2.2, 8, 2);

  let origine = maplibregl.MercatorCoordinate.fromLngLat([0, 0], 0);
  let echelle = origine.meterInMercatorCoordinateUnits();

  function vider(): void {
    for (const o of [...groupe.children]) {
      groupe.remove(o);
      (o as THREE.InstancedMesh).dispose?.();
    }
  }

  const couche: CoucheArbres3D = {
    id,
    type: "custom",
    renderingMode: "3d",

    onAdd(m, gl) {
      map = m;
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl as WebGLRenderingContext, antialias: true });
      renderer.autoClear = false;
    },

    render(_gl, args) {
      if (!renderer || groupe.children.length === 0) return;
      // Repère local : x = est (m), y = haut (m), z = sud (m), centré sur le site.
      const modele = new THREE.Matrix4()
        .makeTranslation(origine.x, origine.y, origine.z)
        .scale(new THREE.Vector3(echelle, -echelle, echelle))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]).multiply(modele);
      renderer.resetState();
      renderer.render(scene, camera);
    },

    onRemove() {
      vider();
      renderer?.dispose();
      renderer = null;
    },

    setArbres(arbres, lat0, lon0) {
      vider();
      origine = maplibregl.MercatorCoordinate.fromLngLat([lon0, lat0], 0);
      echelle = origine.meterInMercatorCoordinateUnits();
      const mLat = 110_540;
      const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
      const liste = arbres.slice(0, MAX_ARBRES);

      const troncs = new THREE.InstancedMesh(geoTronc, matTronc, liste.length);
      const parForme = [geoFeuillus[0], geoFeuillus[1], geoResineux].map((g) => ({ g, items: [] as THREE.Matrix4[], couleurs: [] as THREE.Color[] }));
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const axeY = new THREE.Vector3(0, 1, 0);

      liste.forEach((a, i) => {
        const x = (a.lon - lon0) * mLon;
        const z = -(a.lat - lat0) * mLat;
        const r1 = alea(a.lat, a.lon, 1);
        const r2 = alea(a.lat, a.lon, 2);
        const r3 = alea(a.lat, a.lon, 3);
        // Proportions d'un arbre urbain adulte (retours du 13/11) : fût court,
        // houppier large qui occupe l'essentiel de la hauteur.
        const h = Math.max(4, Math.min(32, a.hauteur ?? 8 + r1 * 8));
        const rayon = Math.max(1.5, Math.min(11, (a.couronne ?? 6 + r2 * 5) / 2));
        const fut = a.resineux ? h * 0.15 : h * 0.28;

        m4.compose(new THREE.Vector3(x, 0, z), q.identity(), new THREE.Vector3(1.2 + rayon * 0.08, fut + rayon * 0.5, 1.2 + rayon * 0.08));
        troncs.setMatrixAt(i, m4);

        const forme = a.resineux ? parForme[2] : parForme[r3 < 0.55 ? 0 : 1];
        // Le houppier remplit l'arbre du haut du fût au sommet, en restant
        // à peu près rond (ni galette, ni fuseau).
        const sy = a.resineux ? (h - fut) / 2.2 : Math.max(rayon * 0.75, Math.min(rayon * 1.15, (h - fut) / 2));
        const cy = a.resineux ? fut + 1.1 * sy : Math.max(fut + sy * 0.8, h - sy);
        q.setFromAxisAngle(axeY, r1 * Math.PI * 2);
        forme.items.push(new THREE.Matrix4().compose(new THREE.Vector3(x, cy, z), q.clone(), new THREE.Vector3(rayon, sy, rayon)));
        forme.couleurs.push(new THREE.Color(VERTS[Math.floor(r2 * VERTS.length)]));
      });
      troncs.instanceMatrix.needsUpdate = true;
      // La caméra est la matrice de MapLibre : le tri par champ de vision de
      // three.js se trompe, on le désactive (quelques centaines d'arbres).
      troncs.frustumCulled = false;
      groupe.add(troncs);

      for (const f of parForme) {
        if (f.items.length === 0) continue;
        const mesh = new THREE.InstancedMesh(f.g, matHouppier, f.items.length);
        f.items.forEach((mat, k) => {
          mesh.setMatrixAt(k, mat);
          mesh.setColorAt(k, f.couleurs[k]);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        groupe.add(mesh);
      }
      map?.triggerRepaint();
    },

    setOpacite(o) {
      matTronc.opacity = o;
      matHouppier.opacity = o;
      // Opaque : plus net et sans tri de transparence.
      matTronc.transparent = matHouppier.transparent = o < 0.99;
      matTronc.depthWrite = matHouppier.depthWrite = o >= 0.99;
      matTronc.needsUpdate = matHouppier.needsUpdate = true;
      map?.triggerRepaint();
    },
  };
  return couche;
}
