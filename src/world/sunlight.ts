import * as THREE from 'three';
import { SUN_DIRECTION } from './sky';

// Le soleil du jeu n'a plus d'ombres (celles de la carte sont précalculées par Blender) : ce qui bouge
// (bots, objets) regarde ici s'il est au soleil, en lançant un rayon vers le soleil à travers les
// collisions de la carte, et s'assombrit à l'ombre.

/** Part de l'éclairage qui reste à l'ombre (lumière du ciel et des rebonds, sans le soleil). */
export const SHADE = 0.45;

let blockers: readonly THREE.Box3[] = [];
const ray = new THREE.Ray();

/** Collisions qui font de l'ombre (celles de la carte et des objets posés). */
export function setSunBlockers(boxes: readonly THREE.Box3[]): void {
  blockers = boxes;
}

/** 1 si le soleil atteint ce point, 0 s'il est caché par un bloc. */
export function sunVisibility(point: THREE.Vector3): number {
  ray.set(point, SUN_DIRECTION);
  for (const box of blockers) {
    // Un point dans une boîte (sous un objet posé, dans sa propre collision) ne s'y cache pas.
    if (ray.intersectsBox(box) && !box.containsPoint(point)) return 0;
  }
  return 1;
}

/** Facteur de couleur selon l'ensoleillement (0 à 1). */
export function sunShade(visibility: number): number {
  return SHADE + (1 - SHADE) * visibility;
}

let blobTexture: THREE.Texture | null = null;

/** Ombre ronde et floue à poser au sol sous un personnage (diamètre en mètres). */
export function blobShadow(diameter: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  if (!blobTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.6)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    blobTexture = new THREE.CanvasTexture(canvas);
  }
  const material = new THREE.MeshBasicMaterial({
    map: blobTexture,
    color: 0x000000,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(diameter, diameter), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.renderOrder = 1;
  return mesh;
}
