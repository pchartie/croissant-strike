import * as THREE from 'three';
import * as textures from './textures';

// Affichage d'une carte construite par Blender (npm run build-map) : un maillage par matériau, avec
// l'éclairage précalculé (soleil, ciel et rebonds) dans une carte d'éclairage. Matériaux sans calcul
// de lumière (MeshBasicMaterial) : couleur de la texture × éclairage, le moins cher possible à dessiner.
// Les lumières du jeu n'éclairent plus que ce qui bouge (bots, armes, grenades, objets).

/** Un matériau de la carte, tel que map/lib/kit.py l'exporte. */
export interface MapMaterial {
  /** Teinte sRGB, multipliée par la texture. */
  color: number;
  /** Texture Poly Haven : public/textures/<texture>_diff.webp. */
  texture?: string;
  /** Texture dessinée par le jeu (fonction de textures.ts), ou image public/textures/<canvas>.png si `alpha`. */
  canvas?: string;
  /** Découpé net selon la transparence de l'image (palmes, affiches). */
  alpha?: boolean;
  /** Transparence progressive, posé sur une autre surface (coulures, fissures). */
  blend?: boolean;
  /** Vu des deux côtés (palmes). */
  double?: boolean;
}

export interface MapLighting {
  /** Valeur d'éclairage d'un pixel blanc de la carte d'éclairage (voir map/lib/bake.py). */
  lightmapScale: number;
  materials: Record<string, MapMaterial>;
}

const CANVASES: Record<string, (anisotropy: number) => THREE.CanvasTexture> = {
  crate: textures.crate,
  grid: textures.grid,
  stripes: textures.stripes,
  palmTrunk: textures.palmTrunk,
};

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

  // Une seule texture par fichier ou par dessin (plusieurs matériaux partagent la même, teintée autrement).
  const shared = new Map<string, Promise<THREE.Texture>>();
  const texture = (key: string, make: () => Promise<THREE.Texture>) => {
    let found = shared.get(key);
    if (!found) {
      found = make().then((map) => {
        map.flipY = false;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.anisotropy = anisotropy;
        return map;
      });
      shared.set(key, found);
    }
    return found;
  };

  const materials = new Map<string, THREE.MeshBasicMaterial>();
  const materialFor = (key: string): THREE.MeshBasicMaterial => {
    let material = materials.get(key);
    if (material) return material;
    const spec = lighting.materials[key] ?? { color: 0xffffff };
    material = new THREE.MeshBasicMaterial({
      color: spec.color,
      lightMap,
      // Le shader divise l'éclairage par π (convention de three.js) : on le compense.
      lightMapIntensity: lighting.lightmapScale * Math.PI,
    });
    if (spec.blend) {
      // Posé à 1 cm d'un mur : dessiné par-dessus sans écrire la profondeur, et rapproché pour ne
      // jamais clignoter avec lui au loin.
      material.transparent = true;
      material.depthWrite = false;
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -4;
    } else if (spec.alpha) {
      material.alphaTest = 0.5;
    }
    if (spec.double) material.side = THREE.DoubleSide;
    let map: Promise<THREE.Texture> | null = null;
    if (spec.texture) map = texture(spec.texture, () => load(`${import.meta.env.BASE_URL}textures/${spec.texture}_diff.webp`, true));
    else if (spec.canvas && spec.alpha) map = texture(spec.canvas, () => load(`${import.meta.env.BASE_URL}textures/${spec.canvas}.png`, true));
    else if (spec.canvas && CANVASES[spec.canvas]) map = texture(spec.canvas, async () => CANVASES[spec.canvas!](anisotropy));
    const target = material;
    map
      ?.then((loaded) => {
        target.map = loaded;
        target.needsUpdate = true;
      })
      .catch(() => console.info(`Texture de « ${key} » absente : couleur unie.`));
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
