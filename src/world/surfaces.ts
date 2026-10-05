import type * as THREE from 'three';

/** Matière d'un bloc : change le bruit des pas et l'impact des balles. */
export type Surface = 'sand' | 'stone' | 'plaster' | 'wood' | 'metal';

/** Matière d'un objet touché (rangée dans `userData.surface` par la carte), grès par défaut. */
export function surfaceOf(object: THREE.Object3D | undefined): Surface {
  return (object?.userData.surface as Surface | undefined) ?? 'stone';
}
