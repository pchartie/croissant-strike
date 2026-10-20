import * as THREE from 'three';
import type { PropId, PropPlacement } from './props';
import type { Collider, World } from './World';

/** Objets qui se cassent sous les balles : jarres, faïences et pots vides (pas ceux qui ont une plante), barils rouges et bonbonnes de gaz. */
export const BREAKABLE: ReadonlySet<PropId> = new Set<PropId>(['clayPot', 'jug', 'faienceVase', 'barrelRed', 'gasBottle']);

/** Objets qui explosent au lieu de se casser, et le nombre de balles qu'ils encaissent avant. */
export const EXPLOSIVE: Partial<Record<PropId, number>> = { barrelRed: 4, gasBottle: 2 };

/** Couleur des éclats, celle de l'objet : terre cuite des pots, faïence blanche des jarres, bleutée des vases. */
export const SHARD_COLORS: Partial<Record<PropId, number>> = { clayPot: 0xa65f3c, jug: 0xe6e1d6, faienceVase: 0xc9d2e8 };

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
  /** Balles reçues (objets explosifs). */
  hits: number;
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
  // Cylindre de secours d'un baril (si son modèle n'est pas chargé) ; les autres collisions ne sont pas dessinées.
  breakable.collider.mesh.visible = false;
  for (const { mesh, index } of breakable.instances) {
    mesh.setMatrixAt(index, HIDDEN);
    mesh.instanceMatrix.needsUpdate = true;
  }
  world.setColliderActive(breakable.collider, false);
  return true;
}

/** Remet l'objet en place, intact. */
export function restoreProp(world: World, breakable: Breakable): void {
  breakable.hits = 0;
  if (!breakable.broken) return;
  breakable.broken = false;
  breakable.collider.mesh.visible = !breakable.collider.mesh.userData.modelShown;
  for (const { mesh, index, matrix } of breakable.instances) {
    mesh.setMatrixAt(index, matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }
  world.setColliderActive(breakable.collider, true);
}
