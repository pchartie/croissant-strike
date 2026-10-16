import * as THREE from 'three';
import * as textures from './textures';

// Affichage d'une carte construite par Blender (npm run build-map) : un maillage par matériau, avec
// l'éclairage précalculé (soleil, ciel et rebonds) dans une carte d'éclairage. Matériaux sans calcul
// de lumière (MeshBasicMaterial) : couleur de la texture × éclairage, le moins cher possible à dessiner.
// Les lumières du jeu n'éclairent plus que ce qui bouge (bots, armes, grenades, objets).

/** Matériaux de la carte, par nom (ceux de map/lib/kit.py) : texture de couleur et teinte. */
const MATERIALS: Record<string, { texture?: string; canvas?: (anisotropy: number) => THREE.Texture; color?: number }> = {
  sand: { texture: 'ground' },
  plaster: { texture: 'plaster' },
  sandstone: { texture: 'sandstone' },
  wood: { texture: 'wood', color: 0xd9a66b },
  crate: { canvas: textures.crate },
  shadowGap: { color: 0x1b1814 },
  // Version grise (mêmes teintes que map/lib/kit.py).
  greyWall: { canvas: textures.grid, color: 0xb4b2ac },
  greyFloor: { canvas: textures.grid, color: 0x8c8a84 },
  greyRaised: { canvas: textures.grid, color: 0xc49a62 },
  greyCover: { canvas: textures.grid, color: 0x8f6a4f },
  greyOverhead: { canvas: textures.grid, color: 0x7d8b98 },
};

export interface MapLighting {
  /** Valeur d'éclairage d'un pixel blanc de la carte d'éclairage (voir map/lib/bake.py). */
  lightmapScale: number;
}

/** Charge le maillage et l'éclairage de la carte `name` (public/maps/<name>/) et les ajoute à la scène. */
export async function loadMapVisuals(scene: THREE.Scene, name: string, lighting: MapLighting, anisotropy: number): Promise<void> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const base = `${import.meta.env.BASE_URL}maps/${name}/`;
  const loader = new THREE.TextureLoader();
  // Textures appliquées comme dans le glTF : sans retournement vertical (flipY), comme Blender les a posées.
  const load = (url: string, color: boolean) =>
    loader.loadAsync(url).then((texture) => {
      texture.flipY = false;
      if (color) texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    });

  const [gltf, lightMap] = await Promise.all([
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${base}${name}.glb`),
    load(`${base}lightmap.webp`, true),
  ]);
  lightMap.channel = 1;

  const materials = new Map<string, THREE.MeshBasicMaterial>();
  const canvases = new Map<(anisotropy: number) => THREE.Texture, THREE.Texture>();
  const materialFor = (key: string): THREE.MeshBasicMaterial => {
    let material = materials.get(key);
    if (material) return material;
    const spec = MATERIALS[key] ?? {};
    material = new THREE.MeshBasicMaterial({
      color: spec.color ?? 0xffffff,
      lightMap,
      // Le shader divise l'éclairage par π (convention de three.js) : on le compense.
      lightMapIntensity: lighting.lightmapScale * Math.PI,
    });
    if (spec.canvas) {
      // Une seule texture par dessin (le quadrillage sert à cinq matériaux).
      let map = canvases.get(spec.canvas);
      if (!map) {
        map = spec.canvas(anisotropy);
        map.flipY = false;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        canvases.set(spec.canvas, map);
      }
      material.map = map;
    } else if (spec.texture) {
      const target = material;
      void load(`${import.meta.env.BASE_URL}textures/${spec.texture}_diff.jpg`, true)
        .then((map) => {
          map.wrapS = map.wrapT = THREE.RepeatWrapping;
          map.anisotropy = anisotropy;
          target.map = map;
          target.needsUpdate = true;
        })
        .catch(() => console.info(`Texture ${spec.texture} absente : couleur unie.`));
    }
    materials.set(key, material);
    return material;
  };

  gltf.scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const original = child.material as THREE.Material;
    child.material = materialFor(original.name);
    original.dispose();
    // Tout est fixe : pas besoin de recalculer les matrices à chaque image.
    child.matrixAutoUpdate = false;
    child.updateMatrix();
  });
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.matrixAutoUpdate = false;
  scene.add(gltf.scene);
}
