import * as THREE from 'three';

export class World {
  readonly colliders: THREE.Box3[] = [];
  /** Objets que les balles peuvent toucher. */
  readonly meshes: THREE.Mesh[] = [];

  constructor(readonly scene: THREE.Scene) {}

  /**
   * Ajoute un bloc solide. `position` est le centre de la face du bas, pour
   * pouvoir poser les objets directement au sol. `tile` est la taille en
   * mètres couverte par une répétition de la texture.
   */
  addBox(
    position: THREE.Vector3,
    size: THREE.Vector3,
    material: THREE.Material,
    tile: number,
  ): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    scaleBoxUVs(geometry, size, tile);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y + size.y / 2, position.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    this.colliders.push(new THREE.Box3().setFromObject(mesh));
    return mesh;
  }
}

/** Répète la texture selon la taille réelle de chaque face, sans l'étirer. */
function scaleBoxUVs(geometry: THREE.BoxGeometry, size: THREE.Vector3, tile: number): void {
  const uv = geometry.attributes.uv;
  // Ordre des faces de BoxGeometry : +x, -x, +y, -y, +z, -z.
  const faces = [
    [size.z, size.y],
    [size.z, size.y],
    [size.x, size.z],
    [size.x, size.z],
    [size.x, size.y],
    [size.x, size.y],
  ];
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, (uv.getX(i) * faces[face][0]) / tile, (uv.getY(i) * faces[face][1]) / tile);
    }
  }
}
