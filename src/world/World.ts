import * as THREE from 'three';
import type { Breakable } from './breakables';

/** Cube de 1 m partagé par toutes les collisions (mis à l'échelle de chacune). */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** Collision posée par addCollider : boîte des déplacements et bloc invisible des balles. */
export interface Collider {
  box: THREE.Box3;
  mesh: THREE.Mesh;
}

export class World {
  readonly colliders: THREE.Box3[] = [];
  /** Objets que les balles peuvent toucher. */
  readonly meshes: THREE.Mesh[] = [];
  /** Objets qui se cassent quand on tire dessus (jarres, pots vides). */
  readonly breakables: Breakable[] = [];

  constructor(readonly scene: THREE.Scene) {}

  /**
   * Ajoute un cylindre debout (baril…) posé en (x, y, z). La collision est une
   * boîte carrée qui l'englobe : le moteur ne gère que des boîtes.
   */
  addCylinder(x: number, y: number, z: number, radius: number, height: number, material: THREE.Material): Collider {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), material);
    mesh.position.set(x, y + height / 2, z);
    this.scene.add(mesh);
    this.meshes.push(mesh);
    const box = new THREE.Box3(new THREE.Vector3(x - radius, y, z - radius), new THREE.Vector3(x + radius, y + height, z + radius));
    this.colliders.push(box);
    return { box, mesh };
  }

  /**
   * Ajoute une collision seule (la carte est dessinée à part, voir MapVisuals) : une boîte pour les
   * déplacements, et un bloc invisible hors de la scène pour les balles et les lignes de vue.
   */
  addCollider(min: THREE.Vector3, max: THREE.Vector3, surface: string): Collider {
    const box = new THREE.Box3(min, max);
    const mesh = new THREE.Mesh(UNIT_BOX);
    box.getSize(mesh.scale);
    box.getCenter(mesh.position);
    mesh.updateMatrixWorld(true);
    mesh.userData.surface = surface;
    this.meshes.push(mesh);
    this.colliders.push(box);
    return { box, mesh };
  }

  /** Retire une collision (objet cassé : on passe et on tire à travers), ou la remet. */
  setColliderActive({ box, mesh }: Collider, active: boolean): void {
    const boxAt = this.colliders.indexOf(box);
    const meshAt = this.meshes.indexOf(mesh);
    if (active) {
      if (boxAt < 0) this.colliders.push(box);
      if (meshAt < 0) this.meshes.push(mesh);
    } else {
      if (boxAt >= 0) this.colliders.splice(boxAt, 1);
      if (meshAt >= 0) this.meshes.splice(meshAt, 1);
    }
  }
}

