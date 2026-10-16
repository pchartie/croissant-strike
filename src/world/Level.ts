import * as THREE from 'three';
import { SUN_DIRECTION } from './sky';
import { loadProps, placeProps } from './props';
import { loadMapVisuals } from './MapVisuals';
import { MAPS } from './maps';
import { Fountain } from './fountain';
import { loadSettings } from '../core/settings';
import type { World } from './World';

// La carte choisie dans les réglages (changer de carte recharge la page). Chaque carte est construite
// par Blender (map/<id>/build.py, `npm run build-map -- <id>`) : maillage et éclairage précalculé dans
// public/maps/<id>/, collisions et objets dans src/maps/<id>.json ; le reste est dans maps.ts.
//
// Règle pour la navigation des bots : un élément au-dessus de la tête (linteau,
// auvent) laisse passer dessous, mais pas de sol au-dessus d'un autre sol (pont, tunnel).

export const ACTIVE_MAP = MAPS[loadSettings().map];
export const LEVEL_BOUNDS = ACTIVE_MAP.bounds;
/** Apparition du joueur : au sud, face au nord. */
export const PLAYER_SPAWN = ACTIVE_MAP.spawn;

/** Ce qui s'anime sur la carte (eau des fontaines…), mis à jour à chaque image. */
export interface Animated {
  update(dt: number): void;
}

/** Construit la carte ; renvoie ce qui s'y anime. */
export function buildLevel(world: World, anisotropy: number): Animated[] {
  setupLighting(world.scene);
  const { data } = ACTIVE_MAP;

  // Collisions tout de suite (déplacements, navigation des bots) ; le maillage arrive ensuite.
  for (const box of data.collisions) {
    world.addCollider(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max), box.surface);
  }
  void loadMapVisuals(world.scene, ACTIVE_MAP.id, data, anisotropy);

  // Objets (modèles Poly Haven, voir props.ts) ; leurs ombres sont dans l'éclairage de la carte.
  const placements = data.props;
  const barrelBlue = new THREE.MeshStandardMaterial({ color: 0x3f5f72, roughness: 0.6, metalness: 0.4 });
  const barrelRust = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.75, metalness: 0.3 });
  placeProps(world, placements, { barrelBlue, barrelRed: barrelRust });
  void loadProps(world, placements);

  const fountains = (ACTIVE_MAP.fountains ?? []).map((spec) => new Fountain(spec));
  for (const fountain of fountains) world.scene.add(fountain.group);
  return fountains;
}

/** Ciel, brouillard et lumières : elles n'éclairent plus que ce qui bouge (la carte a son éclairage). */
function setupLighting(scene: THREE.Scene): void {
  const sky = new THREE.Color(0xa9cbe8);
  scene.background = sky;
  // Brume légère dès 15 m, qui ne cache jamais rien (moins d'un tiers à 80 m) ; couleur réglée par sky.ts.
  scene.fog = new THREE.Fog(sky, 15, 260);

  // Lumière d'ambiance un peu plus faible qu'avant : le ciel HDR (sky.ts) en ajoute.
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x9a8460, 1.0));

  const sun = new THREE.DirectionalLight(0xfff0d0, 2.5);
  // Placé dans la direction du soleil visible dans le ciel.
  sun.position.copy(SUN_DIRECTION).multiplyScalar(55);
  scene.add(sun);
}
