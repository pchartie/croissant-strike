import * as THREE from 'three';
import { World } from './World';
import * as textures from './textures';

const SIZE = 48;
const WALL_HEIGHT = 6;
const BIG_CRATE = 1.6;
const SMALL_CRATE = 0.9;

export const SPAWN = { position: new THREE.Vector3(0, 0, 18), yaw: 0 };
/** Intérieur de l'arène, entre les murs. */
export const ARENA_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-SIZE / 2, 0, -SIZE / 2),
  new THREE.Vector3(SIZE / 2, WALL_HEIGHT, SIZE / 2),
);

/** Petite arène de test : sol, murs, piliers, caisses et une plateforme. */
export function buildArena(world: World, anisotropy: number): void {
  const { scene } = world;
  const sky = new THREE.Color(0x9ec5e8);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 40, 120);

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x8a7a60, 1.4));

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.position.set(14, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const half = SIZE / 2 + 4;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, far: 80 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const floor = new THREE.MeshStandardMaterial({ map: textures.concrete(anisotropy), roughness: 0.95 });
  const wall = new THREE.MeshStandardMaterial({ map: textures.bricks(anisotropy), roughness: 0.9 });
  const crate = new THREE.MeshStandardMaterial({ map: textures.crate(anisotropy), roughness: 0.8 });

  const box = (x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material, tile: number) =>
    world.addBox(new THREE.Vector3(x, y, z), new THREE.Vector3(w, h, d), material, tile);
  const bigCrate = (x: number, z: number, y = 0) => box(x, y, z, BIG_CRATE, BIG_CRATE, BIG_CRATE, crate, BIG_CRATE);
  const smallCrate = (x: number, z: number, y = 0) => box(x, y, z, SMALL_CRATE, SMALL_CRATE, SMALL_CRATE, crate, SMALL_CRATE);

  // Sol et murs d'enceinte.
  box(0, -1, 0, SIZE, 1, SIZE, floor, 4);
  const edge = SIZE / 2 + 0.5;
  box(0, 0, -edge, SIZE + 2, WALL_HEIGHT, 1, wall, 3);
  box(0, 0, edge, SIZE + 2, WALL_HEIGHT, 1, wall, 3);
  box(-edge, 0, 0, 1, WALL_HEIGHT, SIZE, wall, 3);
  box(edge, 0, 0, 1, WALL_HEIGHT, SIZE, wall, 3);

  // Piliers.
  for (const x of [-9, 9]) {
    for (const z of [-6, 6]) box(x, 0, z, 1.6, WALL_HEIGHT, 1.6, wall, 3);
  }

  // Plateforme du fond, accessible par des caisses servant de marches.
  box(0, 0, -19, 12, 1.6, 6, wall, 3);
  smallCrate(-3, -15.4);
  smallCrate(3.5, -15.4);

  // Muret à mi-hauteur pour se mettre à couvert.
  box(-14, 0, 6, 6, 1.1, 0.6, wall, 3);
  box(14, 0, -2, 0.6, 1.1, 6, wall, 3);

  // Piles de caisses.
  bigCrate(-4, 4);
  bigCrate(-4, 4 + BIG_CRATE);
  bigCrate(-4, 4, BIG_CRATE);
  smallCrate(-2.75, 4.3);

  bigCrate(6, 10);
  smallCrate(7.25, 10.2);

  bigCrate(16, 12);
  bigCrate(16 + BIG_CRATE, 12);
  bigCrate(16.8, 12, BIG_CRATE);

  bigCrate(-17, -12);
  smallCrate(-15.75, -12.3);
  bigCrate(-17, -12 + BIG_CRATE, 0);

  smallCrate(3, -4);
  smallCrate(18, -16);
  smallCrate(-12, 17);
}
