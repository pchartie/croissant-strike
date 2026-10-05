import * as THREE from 'three';
import { FLASH } from './definitions';

const toFlash = new THREE.Vector3();

/**
 * Durée d'aveuglement d'une flash pour des yeux à `eye` regardant vers
 * `forward` : maximale face à elle et tout près, réduite de côté, de dos et
 * avec la distance. Nulle si un mur ou une fumée la cache (`visible` faux).
 */
export function flashDuration(flash: THREE.Vector3, eye: THREE.Vector3, forward: THREE.Vector3, visible: boolean): number {
  if (!visible) return 0;
  toFlash.subVectors(flash, eye);
  const distance = toFlash.length();
  const facing = forward.dot(toFlash.divideScalar(Math.max(distance, 1e-6)));
  const angle = facing > 0.75 ? 1 : facing > 0.3 ? 0.65 : facing > -0.3 ? 0.35 : 0.15;
  const range = distance <= FLASH.fullRange ? 1 : Math.max(0, 1 - (distance - FLASH.fullRange) / (FLASH.range - FLASH.fullRange));
  return FLASH.maxDuration * angle * range;
}
