import * as THREE from 'three';
import * as textures from './textures';
import type { World } from './World';

// « Dunes » : petite carte façon de_dust, vue de dessus (nord = -z) :
//
//            ┌──────────────── Apparition nord ────────────────┐
//            │  Site A (plateforme)  │  Milieu nord  │  Site B │
//            │      ▲ escaliers      ├─ portes ──────┤ (plate- │
//            │ Longue A   │passerelle│  Milieu sud   ├─portes B┤
//            │ (couloir)  │ (2,1 m)  │               │Couloir B│
//            └──────────────── Apparition sud (joueur) ────────┘
//
// Règle pour la navigation des bots : pas de sol au-dessus d'un autre sol
// (pas de toit, pont ni tunnel).

const HALF = 36;
const OUTER_WALL = 7;
const WALL = 5;
const STEP_RISE = 0.3;
const STEP_DEPTH = 0.6;
const BIG_CRATE = 1.6;
const SMALL_CRATE = 0.9;
const CATWALK = 2.1;

export const LEVEL_BOUNDS = new THREE.Box3(new THREE.Vector3(-HALF, 0, -HALF), new THREE.Vector3(HALF, OUTER_WALL, HALF));
/** Apparition du joueur : au sud, face au nord. */
export const PLAYER_SPAWN = { position: new THREE.Vector3(0, 0, 31), yaw: 0 };

export function buildLevel(world: World, anisotropy: number): void {
  setupLighting(world.scene);

  const material = (texture: THREE.Texture, roughness = 0.95) => new THREE.MeshStandardMaterial({ map: texture, roughness });
  const sand = material(textures.sand(anisotropy));
  const plaster = material(textures.plaster(anisotropy));
  const bricks = material(textures.bricks(anisotropy), 0.9);
  const concrete = material(textures.concrete(anisotropy));
  const crateMaterial = material(textures.crate(anisotropy), 0.8);

  /** Bloc de x1 à x2, de z1 à z2, du sol `y1` jusqu'à `y2`. */
  const block = (x1: number, z1: number, x2: number, z2: number, y1: number, y2: number, mat: THREE.Material, tile = 3) =>
    world.addBox(
      new THREE.Vector3((x1 + x2) / 2, y1, (z1 + z2) / 2),
      new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1),
      mat,
      tile,
    );
  const wall = (x1: number, z1: number, x2: number, z2: number, height = WALL) => block(x1, z1, x2, z2, 0, height, plaster);
  const crate = (x: number, z: number, size = BIG_CRATE, y = 0) =>
    block(x - size / 2, z - size / 2, x + size / 2, z + size / 2, y, y + size, crateMaterial, size);

  /**
   * Escalier de `steps` marches entre x1 et x2 (ou z1 et z2), qui monte dans la
   * direction donnée en partant du bord `start`. Chaque marche est un bloc plein.
   */
  const stairs = (
    axis: 'x' | 'z',
    start: number,
    direction: 1 | -1,
    from: number,
    to: number,
    steps: number,
    base = 0,
  ) => {
    for (let k = 1; k <= steps; k++) {
      const near = start + direction * (k - 1) * STEP_DEPTH;
      const far = start + direction * k * STEP_DEPTH;
      const [a, b] = [Math.min(near, far), Math.max(near, far)];
      const top = base + k * STEP_RISE;
      if (axis === 'z') block(from, a, to, b, 0, top, concrete, 2);
      else block(a, from, b, to, 0, top, concrete, 2);
    }
  };

  // --- Sol et enceinte ---
  block(-HALF, -HALF, HALF, HALF, -1, 0, sand, 4);
  block(-HALF - 1, -HALF - 1, HALF + 1, -HALF, 0, OUTER_WALL, bricks);
  block(-HALF - 1, HALF, HALF + 1, HALF + 1, 0, OUTER_WALL, bricks);
  block(-HALF - 1, -HALF, -HALF, HALF, 0, OUTER_WALL, bricks);
  block(HALF, -HALF, HALF + 1, HALF, 0, OUTER_WALL, bricks);

  // --- Murs entre les trois voies, avec des passages ---
  // Ouest (longue A) | milieu : passages au nord et au sud.
  wall(-11, -24, -10, -20);
  wall(-11, -17, -10, 14.5);
  wall(-11, 17.5, -10, 22);
  // Milieu | est (couloir B) : un passage au centre.
  wall(10, -24, 11, 6);
  wall(10, 9, 11, 22);

  // --- Milieu ---
  // Passerelle surélevée le long du mur ouest, avec son escalier au sud.
  block(-10, -16, -5, 10.6, 0, CATWALK, concrete, 2);
  stairs('z', 14.2, -1, -10, -5, 6);
  // Garde-corps côté milieu, ouvert au centre pour sauter en bas.
  block(-5.3, -16, -5, -7, CATWALK, CATWALK + 0.9, bricks);
  block(-5.3, -4, -5, 10.6, CATWALK, CATWALK + 0.9, bricks);
  // Portes du milieu : mur en travers avec une ouverture.
  wall(-5, -2, 1, -1);
  wall(4, -2, 10, -1);
  crate(2, 6);
  crate(7, 13);
  crate(8.3, 14.2, SMALL_CRATE);
  crate(6, -10);
  crate(6, -10, BIG_CRATE, BIG_CRATE);
  crate(-1, -7, SMALL_CRATE);
  crate(-2, 18);

  // --- Ouest : longue A et site A ---
  wall(-HALF, -6, -24, 22);
  crate(-17, 12);
  crate(-13.5, 4, SMALL_CRATE);
  crate(-13.5, 5, SMALL_CRATE);
  crate(-20, -2);
  crate(-20, -2, BIG_CRATE, BIG_CRATE);
  // Site A : plateforme de 1,2 m, escaliers au sud et à l'est.
  block(-34, -22, -24, -12, 0, 1.2, concrete, 2);
  stairs('z', -10.2, -1, -31, -27, 3);
  stairs('x', -22.2, -1, -19, -15, 3);
  crate(-30, -18, BIG_CRATE, 1.2);
  crate(-26.5, -14.5, SMALL_CRATE, 1.2);
  crate(-16, -20);

  // --- Est : couloir B et site B ---
  wall(24, 0, HALF, 22);
  // Portes B.
  wall(11, -1, 16, 0);
  wall(19, -1, 24, 0);
  crate(14, 12);
  crate(21, 5, SMALL_CRATE);
  crate(17, 18);
  // Site B : plateforme basse de 0,9 m, escalier à l'ouest.
  block(26, -20, 34, -12, 0, 0.9, concrete, 2);
  stairs('x', 24.8, 1, -18, -14, 2);
  crate(18, -8);
  crate(18, -8, BIG_CRATE, BIG_CRATE);
  crate(19.6, -8);
  crate(22, -18);
  crate(30, -6, SMALL_CRATE);
  crate(31, -6, SMALL_CRATE);
  crate(14, -16);
  crate(31, -16, SMALL_CRATE, 0.9);

  // --- Apparition sud ---
  wall(-HALF, 28, -26, HALF);
  wall(26, 28, HALF, HALF);
  block(-3, 24, 3, 24.6, 0, 1.1, bricks);
  crate(-6, 28);
  crate(8, 30);
  crate(9.25, 31, SMALL_CRATE);

  // --- Apparition nord ---
  wall(-HALF, -HALF, -28, -30);
  wall(28, -HALF, HALF, -30);
  block(-16, -28, -10, -27.4, 0, 1.1, bricks);
  crate(0, -30);
  crate(0, -30, BIG_CRATE, BIG_CRATE);
  crate(-8, -27, SMALL_CRATE);
  crate(12, -32);
}

function setupLighting(scene: THREE.Scene): void {
  const sky = new THREE.Color(0xa9cbe8);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 60, 180);

  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x9a8460, 1.4));

  const sun = new THREE.DirectionalLight(0xfff0d0, 2.8);
  sun.position.set(25, 45, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const extent = HALF + 4;
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, far: 140 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
}
