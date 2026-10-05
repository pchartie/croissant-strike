import * as THREE from 'three';
import * as textures from './textures';
import { SUN_DIRECTION } from './sky';
import type { Surface } from './surfaces';
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
// Règle pour la navigation des bots : un élément au-dessus de la tête (linteau,
// auvent) laisse passer dessous, mais pas de sol au-dessus d'un autre sol (pont, tunnel).

const HALF = 36;
const OUTER_WALL = 7;
const WALL = 5;
const STEP_RISE = 0.3;
const STEP_DEPTH = 0.6;
const BIG_CRATE = 1.6;
const SMALL_CRATE = 0.9;
const CATWALK = 2.1;
/** Taille réelle d'un motif de chaque texture, en mètres (données Poly Haven). */
const SAND_TILE = 2.5;
const PLASTER_TILE = 2;
const STONE_TILE = 3;
const WOOD_TILE = 1;
/** Débord des rebords de grès en haut des murs. */
const CAP = 0.08;
/** Hauteur sous les linteaux des passages. */
const DOOR_HEIGHT = 2.7;

export const LEVEL_BOUNDS = new THREE.Box3(new THREE.Vector3(-HALF, 0, -HALF), new THREE.Vector3(HALF, OUTER_WALL, HALF));
/** Apparition du joueur : au sud, face au nord. */
export const PLAYER_SPAWN = { position: new THREE.Vector3(0, 0, 31), yaw: 0 };

/** Site où poser la bombe : sa zone (plateforme et escaliers) et un point dégagé au milieu. */
export interface BombSite {
  readonly name: 'A' | 'B';
  readonly zone: THREE.Box3;
  readonly center: THREE.Vector3;
  /** Où est peinte la lettre du site. */
  readonly marker: THREE.Vector3;
}

export const BOMB_SITES: readonly BombSite[] = [
  { name: 'A', zone: new THREE.Box3(new THREE.Vector3(-34, 0, -22), new THREE.Vector3(-22, 4, -10)), center: new THREE.Vector3(-27.5, 1.2, -19), marker: new THREE.Vector3(-25.5, 1.2, -17.5) },
  { name: 'B', zone: new THREE.Box3(new THREE.Vector3(24, 0, -21), new THREE.Vector3(34, 4, -10)), center: new THREE.Vector3(29, 0.9, -17.5), marker: new THREE.Vector3(27.5, 0.9, -15) },
];

/** Construit la carte ; renvoie le soleil (pour régler la qualité des ombres). */
export function buildLevel(world: World, anisotropy: number): THREE.DirectionalLight {
  const sun = setupLighting(world.scene);

  // Textures Poly Haven (CC0) à leur taille réelle ; celles dessinées par le code en secours.
  const sand = textures.pbrMaterial('ground', textures.sand(anisotropy), anisotropy);
  const plaster = textures.pbrMaterial('plaster', textures.plaster(anisotropy), anisotropy);
  const stone = textures.pbrMaterial('sandstone', textures.bricks(anisotropy), anisotropy);
  const wood = textures.pbrMaterial('wood', textures.crate(anisotropy), anisotropy, { tint: 0xd9a66b });
  const crateMaterial = new THREE.MeshStandardMaterial({ map: textures.crate(anisotropy), roughness: 0.8 });
  const barrelBlue = new THREE.MeshStandardMaterial({ color: 0x3f5f72, roughness: 0.6, metalness: 0.4 });
  const barrelRust = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.75, metalness: 0.3 });
  const shadowGap = new THREE.MeshStandardMaterial({ color: 0x1b1814, roughness: 1 });

  /** Bloc de x1 à x2, de z1 à z2, du sol `y1` jusqu'à `y2`. */
  const block = (x1: number, z1: number, x2: number, z2: number, y1: number, y2: number, mat: THREE.Material, tile = 3) =>
    world.addBox(
      new THREE.Vector3((x1 + x2) / 2, y1, (z1 + z2) / 2),
      new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1),
      mat,
      tile,
    );
  /** Mur de crépi, coiffé d'un rebord de grès un peu plus large. */
  const wall = (x1: number, z1: number, x2: number, z2: number, height = WALL) => {
    block(x1, z1, x2, z2, 0, height, plaster, PLASTER_TILE);
    block(x1 - CAP, z1 - CAP, x2 + CAP, z2 + CAP, height, height + 0.25, stone, STONE_TILE);
  };
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
      if (axis === 'z') block(from, a, to, b, 0, top, stone, STONE_TILE);
      else block(a, from, b, to, 0, top, stone, STONE_TILE);
    }
  };

  // --- Sol et enceinte ---
  block(-HALF, -HALF, HALF, HALF, -1, 0, sand, SAND_TILE);
  block(-HALF - 1, -HALF - 1, HALF + 1, -HALF, 0, OUTER_WALL, stone, STONE_TILE);
  block(-HALF - 1, HALF, HALF + 1, HALF + 1, 0, OUTER_WALL, stone, STONE_TILE);
  block(-HALF - 1, -HALF, -HALF, HALF, 0, OUTER_WALL, stone, STONE_TILE);
  block(HALF, -HALF, HALF + 1, HALF, 0, OUTER_WALL, stone, STONE_TILE);

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
  block(-10, -16, -5, 10.6, 0, CATWALK, stone, STONE_TILE);
  stairs('z', 14.2, -1, -10, -5, 6);
  // Garde-corps côté milieu, ouvert au centre pour sauter en bas.
  block(-5.3, -16, -5, -7, CATWALK, CATWALK + 0.9, stone, STONE_TILE);
  block(-5.3, -4, -5, 10.6, CATWALK, CATWALK + 0.9, stone, STONE_TILE);
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
  block(-34, -22, -24, -12, 0, 1.2, stone, STONE_TILE);
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
  block(26, -20, 34, -12, 0, 0.9, stone, STONE_TILE);
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
  block(-3, 24, 3, 24.6, 0, 1.1, stone, STONE_TILE);
  crate(-6, 28);
  crate(8, 30);
  crate(9.25, 31, SMALL_CRATE);

  // --- Apparition nord ---
  wall(-HALF, -HALF, -28, -30);
  wall(28, -HALF, HALF, -30);
  block(-16, -28, -10, -27.4, 0, 1.1, stone, STONE_TILE);
  crate(0, -30);
  crate(0, -30, BIG_CRATE, BIG_CRATE);
  crate(-8, -27, SMALL_CRATE);
  crate(12, -32);

  // --- Habillage façon de_dust ---

  /**
   * Linteau au-dessus d'un passage dans un mur (x1..x2, z1..z2 = l'ouverture) :
   * le mur se referme au-dessus de la porte, avec une poutre en bois qui dépasse.
   */
  const doorway = (x1: number, z1: number, x2: number, z2: number) => {
    const alongZ = z2 - z1 > x2 - x1;
    block(x1, z1, x2, z2, DOOR_HEIGHT + 0.2, WALL, stone, STONE_TILE);
    block(x1 - CAP, z1 - CAP, x2 + CAP, z2 + CAP, WALL, WALL + 0.25, stone, STONE_TILE);
    const pad = 0.12;
    if (alongZ) block(x1 - pad, z1 - 0.2, x2 + pad, z2 + 0.2, DOOR_HEIGHT, DOOR_HEIGHT + 0.2, wood, WOOD_TILE);
    else block(x1 - 0.2, z1 - pad, x2 + 0.2, z2 + pad, DOOR_HEIGHT, DOOR_HEIGHT + 0.2, wood, WOOD_TILE);
  };
  doorway(-11, -20, -10, -17); // longue A → milieu nord
  doorway(-11, 14.5, -10, 17.5); // longue A → milieu sud
  doorway(10, 6, 11, 9); // milieu → couloir B
  doorway(1, -2, 4, -1); // portes du milieu
  doorway(16, -1, 19, 0); // portes B

  // Battants de porte ouverts contre les côtés du passage (portes du milieu et portes B).
  const leaf = (x1: number, z1: number, x2: number, z2: number) => block(x1, z1, x2, z2, 0, DOOR_HEIGHT - 0.05, wood, WOOD_TILE);
  leaf(1, -3.45, 1.1, -2);
  leaf(3.9, -3.45, 4, -2);
  leaf(16, 0, 16.1, 1.45);
  leaf(18.9, 0, 19, 1.45);

  /** Auvent en planches à 2,7 m, porté par deux poteaux côté rue. */
  const awning = (x1: number, z1: number, x2: number, z2: number, posts: [number, number][]) => {
    block(x1, z1, x2, z2, 2.7, 2.8, wood, WOOD_TILE);
    for (const [x, z] of posts) block(x - 0.07, z - 0.07, x + 0.07, z + 0.07, 0, 2.7, wood, WOOD_TILE);
  };
  awning(-24, 4, -22.6, 12, [[-22.75, 4.2], [-22.75, 11.8]]); // longue A, contre le bâtiment ouest
  awning(22.6, 12, 24, 20, [[22.75, 12.2], [22.75, 19.8]]); // couloir B, contre le bâtiment est
  awning(-34, 26.6, -27, 28, [[-33.8, 26.75], [-27.2, 26.75]]); // apparition sud

  /** Fenêtre : renfoncement sombre avec un appui en bois, en hauteur sur une façade. */
  const facadeWindow = (x1: number, z1: number, x2: number, z2: number) => {
    block(x1, z1, x2, z2, 3.2, 4.2, shadowGap, 1);
    const alongZ = z2 - z1 > x2 - x1;
    if (alongZ) block(x1 - 0.06, z1 - 0.1, x2 + 0.06, z2 + 0.1, 3.1, 3.2, wood, WOOD_TILE);
    else block(x1 - 0.1, z1 - 0.06, x2 + 0.1, z2 + 0.06, 3.1, 3.2, wood, WOOD_TILE);
  };
  for (const z of [-2, 16]) facadeWindow(-24, z - 0.6, -23.95, z + 0.6); // façade du bâtiment ouest (longue A)
  for (const z of [4, 9]) facadeWindow(23.95, z - 0.6, 24, z + 0.6); // façade du bâtiment est (couloir B)

  // Barils contre les murs, par deux ou trois.
  const barrel = (x: number, z: number, material: THREE.Material) => world.addCylinder(x, 0, z, 0.3, 0.9, material);
  barrel(-11.45, -9, barrelBlue);
  barrel(-11.45, -9.7, barrelRust);
  barrel(11.45, 15, barrelRust);
  barrel(11.45, 15.7, barrelBlue);
  barrel(-33, -7.4, barrelBlue);
  barrel(-32.3, -7.4, barrelBlue);
  barrel(-33, -8.1, barrelRust);
  barrel(25, -1.6, barrelRust);
  barrel(33.5, 27.5, barrelBlue);

  // Palettes en bois (assez basses pour marcher dessus).
  const pallet = (x: number, z: number) => block(x - 0.6, z - 0.5, x + 0.6, z + 0.5, 0, 0.14, wood, WOOD_TILE);
  pallet(-3.5, 27);
  pallet(20.5, -22);
  pallet(-14, -26);

  // Matière de chaque bloc, pour le bruit des pas et l'impact des balles.
  const surfaces = new Map<THREE.Material, Surface>([
    [sand, 'sand'],
    [plaster, 'plaster'],
    [stone, 'stone'],
    [wood, 'wood'],
    [crateMaterial, 'wood'],
    [barrelBlue, 'metal'],
    [barrelRust, 'metal'],
  ]);
  for (const mesh of world.meshes) mesh.userData.surface = surfaces.get(mesh.material as THREE.Material) ?? 'stone';
  return sun;
}

function setupLighting(scene: THREE.Scene): THREE.DirectionalLight {
  const sky = new THREE.Color(0xa9cbe8);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 60, 180);

  // Lumière d'ambiance un peu plus faible qu'avant : le ciel HDR (sky.ts) en ajoute.
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x9a8460, 1.0));

  const sun = new THREE.DirectionalLight(0xfff0d0, 2.8);
  // Placé dans la direction du soleil visible dans le ciel.
  sun.position.copy(SUN_DIRECTION).multiplyScalar(55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const extent = HALF + 4;
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, far: 140 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  return sun;
}
