import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

// Ciel « Kloofendal 48d Partly Cloudy (Pure Sky) » de Poly Haven (CC0), en
// HDR : il sert de fond et d'éclairage ambiant (reflets, lumière du ciel).

const URL = `${import.meta.env.BASE_URL}sky/sky.hdr`;

/**
 * Direction du soleil dans l'image (pixel le plus lumineux : 48° de hauteur),
 * pour que la lumière du jeu et les ombres viennent du soleil visible.
 */
export const SUN_DIRECTION = new THREE.Vector3(0.556, 0.742, 0.376).normalize();

/** Couleur moyenne du ciel à l'horizon, pour que le brouillard s'y fonde. */
const HORIZON = new THREE.Color().setRGB(0.409, 0.443, 0.535, THREE.LinearSRGBColorSpace);

/** Part de l'éclairage venant du ciel (le reste vient du soleil et de la lumière d'ambiance). */
const ENVIRONMENT_INTENSITY = 0.35;

/**
 * Charge le ciel et l'applique aux scènes données (le monde, et l'arme en main
 * pour qu'elle soit éclairée pareil). Garde le ciel uni si le fichier manque.
 */
export async function loadSky(world: THREE.Scene, others: THREE.Scene[] = []): Promise<void> {
  try {
    const texture = await new HDRLoader().loadAsync(URL);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    world.background = texture;
    if (world.fog instanceof THREE.Fog) world.fog.color.copy(HORIZON);
    for (const scene of [world, ...others]) {
      scene.environment = texture;
      scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    }
  } catch (error) {
    console.info('Ciel HDR absent : ciel uni.', error);
  }
}
