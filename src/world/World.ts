import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

  /**
   * Ajoute un cylindre debout (baril…) posé en (x, y, z). La collision est une
   * boîte carrée qui l'englobe : le moteur ne gère que des boîtes.
   */
  addCylinder(x: number, y: number, z: number, radius: number, height: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), material);
    mesh.position.set(x, y + height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.meshes.push(mesh);
    this.colliders.push(new THREE.Box3(new THREE.Vector3(x - radius, y, z - radius), new THREE.Vector3(x + radius, y + height, z + radius)));
    return mesh;
  }

  /**
   * Regroupe les blocs visibles en un seul maillage par matériau : une dizaine d'appels de dessin
   * au lieu de plusieurs centaines (ombres comprises). Les blocs sortent de la scène mais restent
   * dans `meshes`, pour les balles et les lignes de vue. Ceux marqués `fallback` (barils en attente
   * de leur modèle) restent à part, puisqu'ils sont cachés ensuite.
   */
  mergeStatic(): void {
    const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const mesh of this.meshes) {
      const material = mesh.material as THREE.Material;
      if (!mesh.visible || !material.visible || mesh.userData.fallback) continue;
      mesh.updateMatrixWorld(true);
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      // mergeGeometries exige les mêmes attributs partout : on ne garde que position, normale et UV.
      for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
      const list = groups.get(material) ?? [];
      list.push(geometry);
      groups.set(material, list);
      this.scene.remove(mesh);
    }
    for (const [material, geometries] of groups) {
      const merged = new THREE.Mesh(mergeGeometries(geometries), material);
      merged.castShadow = merged.receiveShadow = true;
      // Le maillage couvre toute la carte : rien à gagner à le tester contre le champ de vision.
      merged.frustumCulled = false;
      this.scene.add(merged);
      for (const geometry of geometries) geometry.dispose();
    }
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
