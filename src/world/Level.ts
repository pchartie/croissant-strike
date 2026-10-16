import * as THREE from 'three';
import { SUN_DIRECTION } from './sky';
import { loadProps, placeProps, type PropPlacement } from './props';
import { loadMapVisuals } from './MapVisuals';
import type { World } from './World';
import dunes from '../maps/dunes.json';

// « Dunes » : petite carte façon de_dust, vue de dessus (nord = -z) :
//
//            ┌──────────────── Apparition nord ────────────────┐
//            │  Site A (plateforme)  │  Milieu nord  │  Site B │
//            │      ▲ escaliers      ├─ portes ──────┤ (plate- │
//            │ Longue A   │passerelle│  Milieu sud   ├─portes B┤
//            │ (couloir)  │ (2,1 m)  │               │Couloir B│
//            └──────────────── Apparition sud (joueur) ────────┘
//
// Elle est construite par Blender (map/dunes/build.py, `npm run build-map`) : maillage et éclairage
// précalculé dans public/maps/dunes/, collisions et objets dans src/maps/dunes.json.
//
// Règle pour la navigation des bots : un élément au-dessus de la tête (linteau,
// auvent) laisse passer dessous, mais pas de sol au-dessus d'un autre sol (pont, tunnel).

const HALF = 36;
const OUTER_WALL = 7;

export const LEVEL_BOUNDS = new THREE.Box3(new THREE.Vector3(-HALF, 0, -HALF), new THREE.Vector3(HALF, OUTER_WALL, HALF));
/** Apparition du joueur : au sud, face au nord. */
export const PLAYER_SPAWN = { position: new THREE.Vector3(0, 0, 31), yaw: 0 };

/** Construit la carte. */
export function buildLevel(world: World, anisotropy: number): void {
  setupLighting(world.scene);

  // Collisions tout de suite (déplacements, navigation des bots) ; le maillage arrive ensuite.
  for (const box of dunes.collisions) {
    world.addCollider(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max), box.surface);
  }
  void loadMapVisuals(world.scene, 'dunes', dunes, anisotropy);

  // Objets (modèles Poly Haven, voir props.ts) ; leurs ombres sont dans l'éclairage de la carte.
  const placements = dunes.props as PropPlacement[];
  const barrelBlue = new THREE.MeshStandardMaterial({ color: 0x3f5f72, roughness: 0.6, metalness: 0.4 });
  const barrelRust = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.75, metalness: 0.3 });
  placeProps(world, placements, { barrelBlue, barrelRed: barrelRust });
  void loadProps(world, placements);
}

/** Ciel, brouillard et lumières : elles n'éclairent plus que ce qui bouge (la carte a son éclairage). */
function setupLighting(scene: THREE.Scene): void {
  const sky = new THREE.Color(0xa9cbe8);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 60, 180);

  // Lumière d'ambiance un peu plus faible qu'avant : le ciel HDR (sky.ts) en ajoute.
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x9a8460, 1.0));

  const sun = new THREE.DirectionalLight(0xfff0d0, 2.8);
  // Placé dans la direction du soleil visible dans le ciel.
  sun.position.copy(SUN_DIRECTION).multiplyScalar(55);
  scene.add(sun);
}
