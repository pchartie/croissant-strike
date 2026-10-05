import * as THREE from 'three';
import { GRENADES, type GrenadeType } from './definitions';

// Modèles simples (environ 12 cm de haut), en attendant de vrais modèles 3D.

const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.7, roughness: 0.4 });
const rag = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 1 });
const bodies = new Map<GrenadeType, THREE.MeshStandardMaterial>();

function bodyMaterial(type: GrenadeType): THREE.MeshStandardMaterial {
  if (!bodies.has(type)) {
    const glass = type === 'molotov';
    bodies.set(
      type,
      new THREE.MeshStandardMaterial({
        color: GRENADES[type].color,
        roughness: glass ? 0.2 : 0.7,
        metalness: glass ? 0.1 : 0.3,
        transparent: glass,
        opacity: glass ? 0.85 : 1,
      }),
    );
  }
  return bodies.get(type)!;
}

export function buildGrenadeModel(type: GrenadeType): THREE.Group {
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number, x = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, 0);
    group.add(mesh);
    return mesh;
  };

  if (type === 'molotov') {
    // Bouteille avec un chiffon.
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12), bodyMaterial(type), 0);
    add(new THREE.CylinderGeometry(0.012, 0.03, 0.05, 10), bodyMaterial(type), 0.085);
    add(new THREE.CylinderGeometry(0.014, 0.01, 0.05, 6), rag, 0.13);
  } else if (type === 'he') {
    // Corps rond avec cuillère et goupille.
    add(new THREE.SphereGeometry(0.04, 14, 10), bodyMaterial(type), 0);
    add(new THREE.CylinderGeometry(0.015, 0.018, 0.03, 10), metal, 0.05);
    add(new THREE.BoxGeometry(0.012, 0.07, 0.008), metal, 0.03, 0.03);
  } else {
    // Cylindre (flash, fumigène, leurre) avec tête métallique.
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 14), bodyMaterial(type), 0);
    add(new THREE.CylinderGeometry(0.018, 0.022, 0.025, 10), metal, 0.062);
    add(new THREE.BoxGeometry(0.012, 0.08, 0.008), metal, 0.02, 0.032);
  }
  group.traverse((object) => {
    object.castShadow = true;
  });
  return group;
}
