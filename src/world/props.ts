import * as THREE from 'three';
import type { Surface } from './surfaces';
import type { World } from './World';

// Objets de la carte (barils, jerricanes, sacs, caisses, arbres) : modèles Poly Haven optimisés par
// `npm run optimize-props`. Leurs collisions sont posées dès la construction de la carte (pour la
// navigation des bots) ; les modèles arrivent ensuite, chacun dessiné en un seul appel (instanciation).

export type PropId = 'barrelBlue' | 'barrelRed' | 'jerrycan' | 'trashbag' | 'crate' | 'tree';

interface PropSpec {
  file: string;
  /** Taille du modèle une fois posé (m) : largeur (x), profondeur (z), hauteur. */
  size: [number, number, number];
  surface: Surface;
  /** Collision : tout l'objet, ou seulement le tronc (les branches ne bloquent ni joueurs ni balles). */
  trunk?: number;
  /** Projette une ombre : seulement les gros objets (sur les petits, elle doublait le coût pour presque rien). */
  shadow?: boolean;
}

const SPECS: Record<PropId, PropSpec> = {
  // Même encombrement que les anciens barils (cylindres de 0,6 × 0,9 m).
  barrelBlue: { file: 'barrel-blue', size: [0.61, 0.62, 0.9], surface: 'metal', shadow: true },
  barrelRed: { file: 'barrel-red', size: [0.58, 0.58, 0.9], surface: 'metal', shadow: true },
  jerrycan: { file: 'jerrycan', size: [0.35, 0.17, 0.46], surface: 'metal' },
  trashbag: { file: 'trashbag', size: [0.53, 0.46, 0.57], surface: 'sand' },
  crate: { file: 'crate', size: [0.51, 0.41, 0.25], surface: 'plaster' },
  // L'arbre carquois du pack fait 1,5 m : agrandi pour en faire un vrai arbre.
  tree: { file: 'tree', size: [1.75, 1.76, 2.95], surface: 'wood', trunk: 0.36, shadow: true },
};

export interface PropPlacement {
  id: PropId;
  x: number;
  z: number;
  /** Hauteur de la base (posé sur une palette, empilé…). */
  y?: number;
  /** Rotation autour de la verticale, en degrés. */
  yaw?: number;
}

const BASE = `${import.meta.env.BASE_URL}assets/props/`;

/**
 * Pose les objets : collision et cible pour les balles (boîte invisible) tout de suite. Les barils
 * gardent un cylindre visible en attendant leur modèle (et s'il ne se charge pas).
 */
export function placeProps(world: World, placements: PropPlacement[], fallbackBarrel: Record<'barrelBlue' | 'barrelRed', THREE.Material>): PropPlacement[] {
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  for (const place of placements) {
    const spec = SPECS[place.id];
    const y = place.y ?? 0;
    const [width, depth, height] = spec.size;
    let proxy: THREE.Mesh;
    if (place.id === 'barrelBlue' || place.id === 'barrelRed') {
      proxy = world.addCylinder(place.x, y, place.z, width / 2, height, fallbackBarrel[place.id]);
      proxy.userData.fallback = place.id;
    } else {
      // Boîte englobant l'objet tourné (ou son tronc).
      const yaw = THREE.MathUtils.degToRad(place.yaw ?? 0);
      const [w, d] = spec.trunk ? [spec.trunk, spec.trunk] : [width, depth];
      const cos = Math.abs(Math.cos(yaw));
      const sin = Math.abs(Math.sin(yaw));
      const size = new THREE.Vector3(w * cos + d * sin, height, w * sin + d * cos);
      proxy = world.addBox(new THREE.Vector3(place.x, y, place.z), size, hidden, 1);
      proxy.castShadow = proxy.receiveShadow = false;
    }
    proxy.userData.surface = spec.surface;
  }
  return placements;
}

/** Charge les modèles et les affiche ; en cas d'échec, les cylindres des barils restent. */
export async function loadProps(world: World, placements: PropPlacement[]): Promise<void> {
  // Chargeur glTF et décodeur Meshopt à part (~80 Ko) : ils n'alourdissent pas le démarrage du jeu.
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ids = [...new Set(placements.map((place) => place.id))];
  const loaded = await Promise.all(
    ids.map(async (id) => {
      try {
        return { id, scene: (await loader.loadAsync(`${BASE}${SPECS[id].file}.glb`)).scene };
      } catch (error) {
        console.info(`Objet ${id} absent (${SPECS[id].file}.glb) : lancer \`npm run optimize-props\`.`, error);
        return null;
      }
    }),
  );

  const place = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  for (const model of loaded) {
    if (!model) continue;
    const { id, scene } = model;
    const spots = placements.filter((spot) => spot.id === id);
    const fit = fitMatrix(scene, SPECS[id].size[2]);
    scene.updateMatrixWorld(true);
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      // Un seul appel de dessin pour tous les exemplaires de ce morceau du modèle.
      const mesh = new THREE.InstancedMesh(child.geometry, child.material, spots.length);
      spots.forEach((spot, i) => {
        place.makeRotationY(THREE.MathUtils.degToRad(spot.yaw ?? 0)).setPosition(spot.x, spot.y ?? 0, spot.z);
        mesh.setMatrixAt(i, instance.multiplyMatrices(place, fit).multiply(child.matrixWorld));
      });
      mesh.castShadow = SPECS[id].shadow ?? false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      world.scene.add(mesh);
    });
  }

  // Les barils qui ont leur modèle : leurs cylindres ne servent plus qu'aux collisions et aux balles.
  const shown = new Set(loaded.map((model) => model?.id));
  for (const mesh of world.meshes) if (shown.has(mesh.userData.fallback)) mesh.visible = false;
}

/** Recentre le modèle (base au sol, centré en x et z) et le met à la hauteur voulue. */
function fitMatrix(scene: THREE.Object3D, height: number): THREE.Matrix4 {
  const box = new THREE.Box3().setFromObject(scene);
  const scale = height / (box.max.y - box.min.y);
  const center = box.getCenter(new THREE.Vector3());
  return new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
}
