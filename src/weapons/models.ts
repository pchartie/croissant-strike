import * as THREE from 'three';
import type { WeaponId } from './definitions';

// Modèles d'armes en blocs simples, en attendant de vrais modèles 3D.
// Le canon pointe vers -z, comme la caméra.

export interface WeaponModel {
  root: THREE.Group;
  /** Point de sortie de la flamme du canon. */
  muzzle: THREE.Object3D;
  /** Position de repos dans le champ de vision. */
  rest: THREE.Vector3;
}

const metal = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.7, roughness: 0.45 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.6, roughness: 0.55 });
const wood = new THREE.MeshStandardMaterial({ color: 0x7a4421, roughness: 0.7 });
const polymer = new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.8 });

function part(
  parent: THREE.Object3D,
  material: THREE.Material,
  size: [number, number, number],
  position: [number, number, number],
  tiltX = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.rotation.x = tiltX;
  parent.add(mesh);
  return mesh;
}

function cylinder(
  parent: THREE.Object3D,
  material: THREE.Material,
  radius: number,
  length: number,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function rifle(): WeaponModel {
  const root = new THREE.Group();
  part(root, metal, [0.06, 0.07, 0.36], [0, 0, 0]); // boîtier
  part(root, wood, [0.058, 0.055, 0.2], [0, 0.002, -0.27]); // garde-main
  part(root, darkMetal, [0.026, 0.022, 0.2], [0, 0.045, -0.27]); // tube à gaz
  cylinder(root, darkMetal, 0.011, 0.34, [0, 0.015, -0.5]); // canon
  part(root, darkMetal, [0.008, 0.04, 0.012], [0, 0.05, -0.63]); // guidon
  part(root, darkMetal, [0.03, 0.02, 0.04], [0, 0.045, -0.12]); // hausse
  part(root, darkMetal, [0.04, 0.19, 0.07], [0, -0.11, -0.08], 0.3); // chargeur courbé
  part(root, wood, [0.036, 0.11, 0.05], [0, -0.08, 0.1], -0.35); // poignée
  part(root, wood, [0.046, 0.075, 0.28], [0, -0.025, 0.31], 0.1); // crosse

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.015, -0.68);
  root.add(muzzle);
  return { root, muzzle, rest: new THREE.Vector3(0.17, -0.19, -0.42) };
}

function pistol(): WeaponModel {
  const root = new THREE.Group();
  part(root, metal, [0.036, 0.04, 0.2], [0, 0.03, 0]); // culasse
  part(root, polymer, [0.034, 0.028, 0.17], [0, -0.002, -0.012]); // carcasse
  part(root, polymer, [0.033, 0.13, 0.055], [0, -0.075, 0.06], -0.22); // poignée
  part(root, darkMetal, [0.006, 0.012, 0.01], [0, 0.056, -0.09]); // guidon
  part(root, darkMetal, [0.03, 0.01, 0.012], [0, 0.056, 0.09]); // hausse

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.11);
  root.add(muzzle);
  return { root, muzzle, rest: new THREE.Vector3(0.13, -0.15, -0.34) };
}

export const MODEL_BUILDERS: Record<WeaponId, () => WeaponModel> = { rifle, pistol, knife };

/**
 * Couteau (en mètres), centré sur le manche, axe du manche et de la lame vers +y,
 * tranchant vers +x. Utilisé en blocs et dans la main des bras animés.
 */
export function buildKnife(): THREE.Group {
  const root = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.9, roughness: 0.25 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.85 });

  part(root, grip, [0.026, 0.11, 0.02], [0, 0, 0]); // manche
  part(root, darkMetal, [0.05, 0.012, 0.024], [0.004, 0.06, 0]); // garde
  part(root, darkMetal, [0.03, 0.012, 0.022], [0, -0.058, 0]); // pommeau

  // Lame : large au talon, effilée vers la pointe (biseau côté tranchant).
  const blade = new THREE.Shape();
  blade.moveTo(-0.012, 0);
  blade.lineTo(0.016, 0);
  blade.lineTo(0.012, 0.12);
  blade.lineTo(-0.004, 0.175);
  blade.lineTo(-0.012, 0.13);
  blade.closePath();
  const geometry = new THREE.ExtrudeGeometry(blade, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.002, bevelSegments: 1 });
  geometry.translate(0, 0, -0.002);
  const mesh = new THREE.Mesh(geometry, steel);
  mesh.position.y = 0.066;
  root.add(mesh);
  return root;
}

function knife(): WeaponModel {
  const root = new THREE.Group();
  const model = buildKnife();
  // Tenu lame vers l'avant et vers le haut, comme dans CS:GO.
  model.rotation.set(-1.0, 0.25, -0.35);
  root.add(model);
  const muzzle = new THREE.Object3D();
  root.add(muzzle);
  return { root, muzzle, rest: new THREE.Vector3(0.16, -0.2, -0.32) };
}
