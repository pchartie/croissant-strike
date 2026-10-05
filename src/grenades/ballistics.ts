import * as THREE from 'three';
import { GRENADE_PHYSICS } from './definitions';

/** Temps de vol visé : la grenade arrive sur la cible juste avant d'exploser (détonateur de 1,5 s). */
const FLIGHT_TIME = 1.4;

/**
 * Vitesse de lancer pour qu'une grenade partie de `from` arrive sur `to` en
 * `FLIGHT_TIME` secondes (un lancer en cloche, qui explose sur place au lieu de
 * rouler plus loin). Si c'est trop loin pour la force du lancer, tir le plus
 * tendu possible ; et si même ça ne suffit pas, au plus loin, à 45°.
 */
export function throwVelocity(from: THREE.Vector3, to: THREE.Vector3, speed = GRENADE_PHYSICS.throwSpeed): THREE.Vector3 {
  const g = GRENADE_PHYSICS.gravity;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const horizontal = Math.hypot(dx, dz);
  const height = to.y - from.y;
  const dir = horizontal > 1e-6 ? new THREE.Vector2(dx / horizontal, dz / horizontal) : new THREE.Vector2(0, 1);

  // Lancer chronométré : vitesse horizontale constante, vitesse verticale pour retomber à la bonne hauteur.
  const t = FLIGHT_TIME;
  const timed = new THREE.Vector3(dir.x * (horizontal / t), (height + 0.5 * g * t * t) / t, dir.y * (horizontal / t));
  if (timed.length() <= speed) return timed;

  // Trop loin : θ = atan((v² - √(v⁴ - g(g·x² + 2·y·v²))) / (g·x)), la solution la plus tendue.
  const v2 = speed * speed;
  const root = v2 * v2 - g * (g * horizontal * horizontal + 2 * height * v2);
  const angle = root >= 0 && horizontal > 1e-3 ? Math.atan((v2 - Math.sqrt(root)) / (g * horizontal)) : Math.PI / 4;
  const flat = Math.cos(angle) * speed;
  return new THREE.Vector3(dir.x * flat, Math.sin(angle) * speed, dir.y * flat);
}
