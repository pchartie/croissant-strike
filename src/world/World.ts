import * as THREE from 'three';

/** Cube de 1 m partagé par toutes les collisions (mis à l'échelle de chacune). */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

export class World {
  readonly colliders: THREE.Box3[] = [];
  /** Objets que les balles peuvent toucher. */
  readonly meshes: THREE.Mesh[] = [];

  constructor(readonly scene: THREE.Scene) {}

  /**
   * Ajoute un cylindre debout (baril…) posé en (x, y, z). La collision est une
   * boîte carrée qui l'englobe : le moteur ne gère que des boîtes.
   */
  addCylinder(x: number, y: number, z: number, radius: number, height: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), material);
    mesh.position.set(x, y + height / 2, z);
    this.scene.add(mesh);
    this.meshes.push(mesh);
    this.colliders.push(new THREE.Box3(new THREE.Vector3(x - radius, y, z - radius), new THREE.Vector3(x + radius, y + height, z + radius)));
    return mesh;
  }

  /**
   * Ajoute une collision seule (la carte est dessinée à part, voir MapVisuals) : une boîte pour les
   * déplacements, et un bloc invisible hors de la scène pour les balles et les lignes de vue.
   */
  addCollider(min: THREE.Vector3, max: THREE.Vector3, surface: string): void {
    const box = new THREE.Box3(min, max);
    const mesh = new THREE.Mesh(UNIT_BOX);
    box.getSize(mesh.scale);
    box.getCenter(mesh.position);
    mesh.updateMatrixWorld(true);
    mesh.userData.surface = surface;
    this.meshes.push(mesh);
    this.colliders.push(box);
  }
}

