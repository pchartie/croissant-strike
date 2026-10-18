import * as THREE from 'three';
import { BREAKABLE } from './breakables';
import type { Surface } from './surfaces';
import { sunShade, sunVisibility } from './sunlight';
import type { World } from './World';

// Objets posés sur les cartes (barils, voiture bâchée, climatiseurs, jarres, café…) : modèles Poly Haven optimisés par
// `npm run optimize-props`. Leurs collisions sont posées dès la construction de la carte (pour la
// navigation des bots) ; les modèles arrivent ensuite, chacun dessiné en un seul appel (instanciation).

export type PropId =
  | 'barrelBlue'
  | 'barrelRed'
  | 'jerrycan'
  | 'crate'
  | 'coveredCar'
  | 'aircon'
  | 'clayPot'
  | 'pottedPlant'
  | 'jug'
  | 'plasticChair'
  | 'cafeTable'
  | 'trashCan'
  | 'lantern'
  | 'shopShutter'
  | 'windowShutter'
  | 'utilityBox'
  | 'manhole'
  | 'cementBag'
  | 'bench'
  | 'brassPot'
  | 'brassVase'
  | 'faienceVase'
  | 'planterBox'
  | 'woodenStool'
  | 'blueChair'
  | 'gasBottle'
  | 'tyre';

interface PropSpec {
  file: string;
  /** Taille du modèle une fois posé (m) : largeur (x), profondeur (z), hauteur. */
  size: [number, number, number];
  surface: Surface;
  /** Collision : tout l'objet, ou seulement le tronc (les branches ne bloquent ni joueurs ni balles). */
  trunk?: number;
  /** Sans collision : objet à ras du sol (plaque d'égout), qu'on ne doit pas sentir sous ses pieds. */
  flat?: boolean;
}

const SPECS: Record<PropId, PropSpec> = {
  // Même encombrement que les anciens barils (cylindres de 0,6 × 0,9 m).
  barrelBlue: { file: 'barrel-blue', size: [0.61, 0.62, 0.9], surface: 'metal' },
  barrelRed: { file: 'barrel-red', size: [0.58, 0.58, 0.9], surface: 'metal' },
  jerrycan: { file: 'jerrycan', size: [0.35, 0.17, 0.46], surface: 'metal' },
  crate: { file: 'crate', size: [0.51, 0.41, 0.25], surface: 'plaster' },
  // Médina. Taille réelle des modèles, sauf les pots, la cruche et la lanterne, agrandis (jarres, lanterne
  // murale). Mêmes hauteurs que dans map/lib/props.py, qui les pose pour l'éclairage précalculé.
  coveredCar: { file: 'covered-car', size: [1.79, 4.38, 1.41], surface: 'metal' },
  // Deux appareils côte à côte, posés en hauteur sur les façades.
  aircon: { file: 'aircon', size: [1.8, 0.38, 0.93], surface: 'metal' },
  clayPot: { file: 'clay-pot', size: [0.65, 0.65, 0.55], surface: 'stone' },
  pottedPlant: { file: 'potted-plant', size: [0.59, 0.63, 1.35], surface: 'stone', trunk: 0.45 },
  jug: { file: 'jug', size: [0.37, 0.37, 0.7], surface: 'stone' },
  plasticChair: { file: 'plastic-chair', size: [0.64, 0.63, 0.88], surface: 'plaster' },
  cafeTable: { file: 'cafe-table', size: [1.87, 0.89, 0.75], surface: 'wood' },
  // Deux poubelles côte à côte (l'une sans couvercle).
  trashCan: { file: 'trash-can', size: [1.78, 0.56, 0.91], surface: 'metal' },
  lantern: { file: 'lantern', size: [0.19, 0.16, 0.45], surface: 'metal' },
  // Façades : rideau de fer d'une boutique, volet roulant d'une fenêtre, coffret électrique.
  shopShutter: { file: 'shop-shutter', size: [2.1, 0.3, 1.85], surface: 'metal' },
  windowShutter: { file: 'window-shutter', size: [0.98, 0.15, 1.55], surface: 'metal' },
  utilityBox: { file: 'utility-box', size: [0.52, 0.43, 1.12], surface: 'metal' },
  // Sol : plaque d'égout, sacs de ciment, banc.
  // Enfoncée dans le sol (posée à -6,5 cm par la carte) : seul son dessus dépasse, de 5 mm.
  manhole: { file: 'manhole', size: [0.69, 0.69, 0.07], surface: 'metal', flat: true },
  cementBag: { file: 'cement-bag', size: [0.46, 0.7, 0.18], surface: 'sand' },
  bench: { file: 'bench', size: [1.16, 0.5, 0.89], surface: 'wood' },
  // Troisième passe : dinanderie des étals (agrandie), faïence bleue (cassable), bac en bois et bonbonne
  // de gaz (agrandis), mobilier du café, vieux pneu appuyé au mur.
  brassPot: { file: 'brass-pot', size: [0.39, 0.39, 0.38], surface: 'metal' },
  brassVase: { file: 'brass-vase', size: [0.17, 0.17, 0.4], surface: 'metal' },
  faienceVase: { file: 'faience-vase', size: [0.36, 0.36, 0.62], surface: 'stone' },
  planterBox: { file: 'planter-box', size: [1.28, 0.58, 0.59], surface: 'wood' },
  woodenStool: { file: 'wooden-stool', size: [0.38, 0.41, 0.58], surface: 'wood' },
  blueChair: { file: 'blue-chair', size: [0.51, 0.52, 1.0], surface: 'wood' },
  gasBottle: { file: 'gas-bottle', size: [0.44, 0.44, 0.72], surface: 'metal' },
  tyre: { file: 'tyre', size: [0.6, 0.165, 0.6], surface: 'sand' },
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
  for (const place of placements) {
    const spec = SPECS[place.id];
    const y = place.y ?? 0;
    const [width, depth, height] = spec.size;
    if (place.id === 'barrelBlue' || place.id === 'barrelRed') {
      const barrel = world.addCylinder(place.x, y, place.z, width / 2, height, fallbackBarrel[place.id]);
      barrel.userData.fallback = place.id;
      barrel.userData.surface = spec.surface;
      continue;
    }
    if (spec.flat) continue;
    // Boîte englobant l'objet tourné (ou son tronc).
    const yaw = THREE.MathUtils.degToRad(place.yaw ?? 0);
    const [w, d] = spec.trunk ? [spec.trunk, spec.trunk] : [width, depth];
    const cos = Math.abs(Math.cos(yaw));
    const sin = Math.abs(Math.sin(yaw));
    const half = new THREE.Vector3((w * cos + d * sin) / 2, 0, (w * sin + d * cos) / 2);
    const collider = world.addCollider(
      new THREE.Vector3(place.x - half.x, y, place.z - half.z),
      new THREE.Vector3(place.x + half.x, y + height, place.z + half.z),
      spec.surface,
    );
    if (BREAKABLE.has(place.id)) {
      const breakable = {
        spot: place,
        collider,
        center: new THREE.Vector3(place.x, y + height / 2, place.z),
        radius: Math.min(width, depth) / 2,
        height,
        instances: [],
        broken: false,
      };
      collider.mesh.userData.breakable = breakable;
      world.breakables.push(breakable);
    }
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
  // Ensoleillement de chaque exemplaire (la carte n'a pas d'ombres en temps réel) : moyenne de
  // rayons vers le soleil, à mi-hauteur et en haut de l'objet.
  const probe = new THREE.Vector3();
  const shade = new THREE.Color();
  const shadeOf = (spot: PropPlacement): number => {
    const height = SPECS[spot.id].size[2];
    const y = spot.y ?? 0;
    const sun = (sunVisibility(probe.set(spot.x, y + height * 0.5, spot.z)) + sunVisibility(probe.set(spot.x, y + height * 0.95, spot.z))) / 2;
    return sunShade(sun);
  };
  for (const model of loaded) {
    if (!model) continue;
    const { id, scene } = model;
    const spots = placements.filter((spot) => spot.id === id);
    const fit = fitMatrix(scene, SPECS[id].size[2]);
    scene.updateMatrixWorld(true);
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      // Verre qui réfracte (lanterne) : three.js redessinerait toute la scène une seconde fois à chaque
      // image pour voir à travers. Une simple transparence suffit.
      const material = child.material as THREE.MeshPhysicalMaterial;
      if (material.transmission > 0) {
        material.transmission = 0;
        material.transparent = true;
        material.opacity = 0.35;
        material.depthWrite = false;
      }
      // Un seul appel de dessin pour tous les exemplaires de ce morceau du modèle.
      const mesh = new THREE.InstancedMesh(child.geometry, material, spots.length);
      spots.forEach((spot, i) => {
        place.makeRotationY(THREE.MathUtils.degToRad(spot.yaw ?? 0)).setPosition(spot.x, spot.y ?? 0, spot.z);
        instance.multiplyMatrices(place, fit).multiply(child.matrixWorld);
        mesh.setMatrixAt(i, instance);
        mesh.setColorAt(i, shade.setScalar(shadeOf(spot)));
        // Objet cassable : on garde son exemplaire pour le cacher quand il se casse (déjà cassé : caché).
        const breakable = world.breakables.find((candidate) => candidate.spot === spot);
        if (!breakable) return;
        breakable.instances.push({ mesh, index: i, matrix: instance.clone() });
        if (breakable.broken) mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      });
      mesh.computeBoundingSphere();
      world.scene.add(mesh);
    });
  }

  // Les barils qui ont leur modèle : leurs cylindres ne servent plus qu'aux collisions et aux balles.
  const shown = new Set(loaded.map((model) => model?.id));
  for (const mesh of world.meshes) if (shown.has(mesh.userData.fallback)) mesh.visible = false;
}

/**
 * Recentre le modèle (base au sol, centré en x et z) et le met à la hauteur voulue. Boîte calculée sur
 * les sommets (`precise`) : celle des morceaux tournés serait trop grande (poubelles réduites et en l'air).
 */
function fitMatrix(scene: THREE.Object3D, height: number): THREE.Matrix4 {
  const box = new THREE.Box3().setFromObject(scene, true);
  const scale = height / (box.max.y - box.min.y);
  const center = box.getCenter(new THREE.Vector3());
  return new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
}
