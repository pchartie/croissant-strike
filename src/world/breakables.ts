import * as THREE from 'three';
import type { PropId, PropPlacement } from './props';
import type { Collider, World } from './World';

/** Objets qui se cassent sous les balles : les jarres et les pots vides (pas ceux qui ont une plante). */
export const BREAKABLE: ReadonlySet<PropId> = new Set<PropId>(['clayPot', 'jug']);

/** Couleur des éclats, celle de l'objet : terre cuite des pots, faïence blanche des jarres. */
export const SHARD_COLORS: Partial<Record<PropId, number>> = { clayPot: 0xa65f3c, jug: 0xe6e1d6 };

export interface Breakable {
  spot: PropPlacement;
  collider: Collider;
  /** Milieu de l'objet, et son rayon et sa hauteur (pour les éclats). */
  center: THREE.Vector3;
  radius: number;
  height: number;
  /** Exemplaires dessinés (un par morceau du modèle), avec leur placement pour les remettre. */
  instances: { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }[];
  broken: boolean;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** L'objet cassable touché par un rayon (bloc invisible de sa collision), ou null. */
export function breakableOf(object: THREE.Object3D): Breakable | null {
  return (object.userData.breakable as Breakable | undefined) ?? null;
}

/** Casse l'objet : il disparaît avec sa collision. Faux s'il l'était déjà. */
export function breakProp(world: World, breakable: Breakable): boolean {
  if (breakable.broken) return false;
  breakable.broken = true;
  for (const { mesh, index } of breakable.instances) {
    mesh.setMatrixAt(index, HIDDEN);
    mesh.instanceMatrix.needsUpdate = true;
  }
  world.setColliderActive(breakable.collider, false);
  return true;
}

/** Remet l'objet en place, intact. */
export function restoreProp(world: World, breakable: Breakable): void {
  if (!breakable.broken) return;
  breakable.broken = false;
  for (const { mesh, index, matrix } of breakable.instances) {
    mesh.setMatrixAt(index, matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }
  world.setColliderActive(breakable.collider, true);
}
