import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CASING_COLORS, type CasingKind } from './Casings';
import type { WeaponId } from './definitions';
import { buildKnife, knifeOrientation } from './models';

// Armes et bras animés du Retro Weapon Pack, préparés par
// `npm run import-weapons` dans public/assets/weapons/.

const BASE = `${import.meta.env.BASE_URL}assets/weapons/`;
/** Le pack est en centimètres. */
const CM = 0.01;
/**
 * Fondus entre l'animation ponctuelle (tir, sortie…) et l'animation de base, en secondes. Le retour
 * au repos est adouci au début et à la fin : un fondu qui démarrait d'un coup faisait sauter les bras.
 */
const FADE_IN = 0.06;
const FADE_OUT = 0.3;
/** Décalage de l'arme en main (mètres) : un peu à droite et vers le bas pour dégager le réticule. */
const VIEW_OFFSET = new THREE.Vector3(0.02, -0.015, 0);

interface GunSpec {
  /** Nom des fichiers (fusil : rifle.fbx, rifle-extra.fbx, arms-rifle.json…). */
  file: string;
  /** Pièce de `<file>-extra.fbx` qui sert de chargeur, et l'os où la fixer (aucune pour le fusil à pompe). */
  magazine?: { mesh: string; bone: string };
  /** Bout du canon, dans le repère de l'arme, en cm. */
  muzzle: [number, number, number];
}

type GunId = Exclude<WeaponId, 'knife'>;

const GUNS: Record<GunId, GunSpec> = {
  rifle: { file: 'rifle', magazine: { mesh: 'Rifle_01_Magazine_2+Bullets', bone: 'Magazine' }, muzzle: [60, 16.5, 0] },
  smg: { file: 'smg', magazine: { mesh: 'SMG_01_Magazine2+Bullets_Mesh', bone: 'Magazine' }, muzzle: [36.4, 16.6, 0] },
  // Fusil à pompe : sa pose de repos est retournée dans le FBX (voir alignRestPose).
  shotgun: { file: 'shotgun', muzzle: [64.5, 9.2, 0] },
  pistol: { file: 'pistol', magazine: { mesh: 'Pistol_01_Magazine_Full_Mesh', bone: 'Main' }, muzzle: [19.2, 12, 0] },
};

/**
 * Couteau dans la main droite (repère de l'os hand_item_r, en cm : +x vers l'avant,
 * +y vers le haut, -z vers la gauche) : manche dans le poing, lame presque
 * horizontale, vers l'avant et un peu à gauche, tranchant vers le bas, comme dans CS:GO.
 */
const KNIFE_GRIP = { position: new THREE.Vector3(0.8, 4.5, 0), blade: new THREE.Vector3(1, 0.1, -0.4) };
/** Décalage des bras (mètres) pour que la main reste bien visible en bas à droite. */
const KNIFE_POSE = { pitch: 0, offset: new THREE.Vector3(0.06, 0.07, 0) };

/** Animations en boucle, mélangées selon la vitesse et l'accroupissement. */
const CYCLES = ['idle', 'walk', 'run', 'crouchIdle', 'crouchWalk'];

/** Animations jouées une fois : fire, reload, draw, hide, et reloadStart/Step/End pour le fusil à pompe. */
type OneShot = string;

/** Bras + arme animés, pour une arme. */
export class AnimatedWeapon {
  /** Point de sortie de la flamme du canon. */
  readonly muzzle = new THREE.Object3D();

  private readonly armsMixer: THREE.AnimationMixer;
  private readonly gunMixer: THREE.AnimationMixer;
  private readonly arms: Record<string, THREE.AnimationAction> = {};
  private readonly gun: Record<string, THREE.AnimationAction> = {};
  private oneShot: OneShot | null = null;
  /** 0 = animation de base (repos/marche), 1 = animation ponctuelle (tir, rechargement…). */
  private override = 0;
  private walk = 0;
  private crouch = 0;

  constructor(
    readonly root: THREE.Group,
    armsRig: THREE.Object3D,
    gunRig: THREE.Object3D,
    armsClips: THREE.AnimationClip[],
    gunClips: THREE.AnimationClip[],
    muzzle: [number, number, number],
    /** Os réduits à rien après chaque image (le bras gauche quand on tient le couteau). */
    private readonly hiddenBones: THREE.Object3D[] = [],
  ) {
    this.armsMixer = new THREE.AnimationMixer(armsRig);
    this.gunMixer = new THREE.AnimationMixer(gunRig);
    for (const clip of armsClips) this.arms[clip.name] = this.armsMixer.clipAction(clip);
    for (const clip of gunClips) this.gun[clip.name] = this.gunMixer.clipAction(clip);

    for (const name of ['idle', 'walk', 'crouchIdle', 'crouchWalk']) this.arms[name]?.play();
    for (const [name, action] of Object.entries(this.arms)) {
      if (CYCLES.includes(name)) continue;
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    for (const action of Object.values(this.gun)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
    }

    this.muzzle.position.set(...muzzle);
    gunRig.add(this.muzzle);
  }

  /** Joue une animation ponctuelle ; `duration` l'accélère ou la ralentit pour tenir ce temps. */
  play(name: OneShot, duration?: number): void {
    // Le tir n'interrompt pas un rechargement complet ou une sortie d'arme (mais bien
    // un rechargement cartouche par cartouche).
    if (name === 'fire' && (this.oneShot === 'reload' || this.oneShot === 'draw') && this.arms[this.oneShot]?.isRunning()) return;
    const action = this.arms[name];
    if (action) {
      if (this.oneShot && this.oneShot !== name) this.arms[this.oneShot]?.stop();
      this.oneShot = name;
      action.reset();
      action.timeScale = duration ? action.getClip().duration / duration : 1;
      action.play();
      // Sortie et rangement partent tout de suite, sans fondu depuis la pose de repos.
      if (name === 'draw' || name === 'hide') this.override = 1;
    }

    const gunAction = this.gun[name];
    if (gunAction) {
      gunAction.reset();
      gunAction.timeScale = duration ? gunAction.getClip().duration / duration : 1;
      gunAction.play();
    }
  }

  /** Vrai si l'animation ponctuelle `name` est en cours. */
  playing(name: OneShot): boolean {
    return this.oneShot === name && this.arms[name]?.isRunning() === true;
  }

  /** Vrai si l'arme a une animation `name`. */
  has(name: OneShot): boolean {
    return name in this.arms;
  }

  /** Arrête tout (changement d'arme). */
  stop(): void {
    if (this.oneShot) this.arms[this.oneShot].stop();
    this.oneShot = null;
    this.gunMixer.stopAllAction();
  }

  /** `speed` : 0 (arrêt) à 1 (pleine vitesse, debout ou accroupi) ; `crouched` : accroupi. */
  update(dt: number, speed: number, onGround: boolean, crouched = false): void {
    // Repos ↔ marche selon la vitesse du joueur, debout ↔ accroupi.
    const targetWalk = onGround ? speed : 0;
    const blend = Math.min(1, dt * 8);
    this.walk += (targetWalk - this.walk) * blend;
    this.crouch += ((crouched && this.arms.crouchIdle ? 1 : 0) - this.crouch) * blend;
    this.arms.walk.timeScale = 0.6 + 0.6 * this.walk;
    if (this.arms.crouchWalk) this.arms.crouchWalk.timeScale = 0.6 + 0.6 * this.walk;

    // Une fois l'animation ponctuelle finie, elle reste figée sur sa dernière
    // image pendant qu'on revient en fondu vers l'animation de base.
    const current = this.oneShot ? this.arms[this.oneShot] : null;
    const active = current !== null && current.isRunning();
    this.override = active ? Math.min(1, this.override + dt / FADE_IN) : Math.max(0, this.override - dt / FADE_OUT);
    if (current && !active && this.override === 0) {
      current.stop();
      this.oneShot = null;
    }

    const weight = THREE.MathUtils.smoothstep(this.override, 0, 1);
    const base = 1 - weight;
    const standing = base * (1 - this.crouch);
    const crouching = base * this.crouch;
    this.arms.idle.setEffectiveWeight(standing * (1 - this.walk));
    this.arms.walk.setEffectiveWeight(standing * this.walk);
    this.arms.crouchIdle?.setEffectiveWeight(crouching * (1 - this.walk));
    this.arms.crouchWalk?.setEffectiveWeight(crouching * this.walk);
    current?.setEffectiveWeight(weight);

    this.armsMixer.update(dt);
    this.gunMixer.update(dt);
    for (const bone of this.hiddenBones) bone.scale.setScalar(1e-3);
  }
}

/** Charge les armes animées, ou renvoie null si les fichiers n'ont pas été importés. */
export interface RetroWeapons {
  /** Bras + arme animés, pour la vue à la première personne. */
  viewModels: Record<WeaponId, AnimatedWeapon>;
  /** Fusil seul (avec chargeur), figé en un seul maillage, à cloner pour les bots. */
  botRifle: THREE.Object3D;
  /** Douilles éjectées (null si projectiles.fbx manque : cylindres de secours). */
  casings: Record<CasingKind, THREE.Object3D> | null;
  /** Éclats de mur (null si debris.fbx manque). */
  debris: THREE.Object3D | null;
}

export async function loadRetroWeapons(): Promise<RetroWeapons | null> {
  try {
    const manager = new THREE.LoadingManager();
    // Les textures référencées dans les FBX sont remplacées plus bas : on ne les télécharge pas
    // (nos propres textures passent par un autre chargeur, sans ce gestionnaire).
    manager.setURLModifier((url) => (/\.(png|jpe?g|tga)$|\/$/i.test(url) ? EMPTY_PNG : url));
    const fbx = new FBXLoader(manager);
    const textures = new THREE.TextureLoader();

    const [armsSource, armsTexture, projectilesTexture, projectiles, debris] = await Promise.all([
      fbx.loadAsync(`${BASE}arms.fbx`),
      textures.loadAsync(`${BASE}arms.png`),
      textures.loadAsync(`${BASE}projectiles.png`),
      fbx.loadAsync(`${BASE}projectiles.fbx`).catch(() => null),
      fbx.loadAsync(`${BASE}debris.fbx`).catch(() => null),
    ]);

    const viewModels = {} as Record<WeaponId, AnimatedWeapon>;
    let botRifle: THREE.Object3D | null = null;
    let pistolClips: THREE.AnimationClip[] = [];
    for (const id of Object.keys(GUNS) as GunId[]) {
      const spec = GUNS[id];
      const [gun, extra, gunTexture, armsClips, gunClips] = await Promise.all([
        fbx.loadAsync(`${BASE}${spec.file}.fbx`),
        spec.magazine ? fbx.loadAsync(`${BASE}${spec.file}-extra.fbx`) : Promise.resolve(null),
        textures.loadAsync(`${BASE}${spec.file}.png`),
        loadClips(`${BASE}arms-${spec.file}.json`),
        loadClips(`${BASE}${spec.file}-anims.json`),
      ]);

      const materials = { arms: armsTexture, gun: gunTexture, projectiles: projectilesTexture };
      alignRestPose(gun, gunClips);
      if (extra && spec.magazine) attachMagazine(gun, extra, spec.magazine);
      applyMaterials(gun, materials);
      if (id === 'rifle') botRifle = bakeStatic(gun);
      if (id === 'pistol') pistolClips = armsClips;

      const arms = cloneSkinned(armsSource);
      applyMaterials(arms, materials);
      arms.getObjectByName('hand_item_r')!.add(gun);

      // Repère du pack : la caméra regarde vers +x avec +y en haut ; le nôtre regarde vers -z.
      const root = new THREE.Group();
      arms.rotation.y = Math.PI / 2;
      arms.scale.setScalar(CM);
      arms.position.copy(VIEW_OFFSET);
      root.add(arms);
      root.visible = false;

      viewModels[id] = new AnimatedWeapon(root, arms, gun, armsClips, gunClips, spec.muzzle);
    }
    viewModels.knife = buildKnifeArms(armsSource, pistolClips, { arms: armsTexture, gun: armsTexture, projectiles: projectilesTexture });
    const casings = projectiles ? casingModels(projectiles) : null;
    return { viewModels, botRifle: botRifle!, casings, debris };
  } catch (error) {
    console.info('Armes animées absentes, modèles simples utilisés. Lancer `npm run import-weapons`.', error);
    return null;
  }
}

/**
 * Douilles du pack (en cm, couchées le long de x), recentrées et mises à l'échelle. Couleur unie :
 * la texture du pack, surtout sombre, les rendait presque noires une fois réduites à quelques pixels.
 */
function casingModels(source: THREE.Object3D): Record<CasingKind, THREE.Object3D> {
  const brass = new THREE.MeshStandardMaterial({ color: CASING_COLORS.brass, roughness: 0.5, metalness: 0.2 });
  const plastic = new THREE.MeshStandardMaterial({ color: CASING_COLORS.plastic, roughness: 0.6 });
  const model = (name: string, material: THREE.Material) => {
    const mesh = source.getObjectByName(name) as THREE.Mesh;
    const geometry = mesh.geometry.clone();
    geometry.scale(mesh.scale.x * CM, mesh.scale.y * CM, mesh.scale.z * CM);
    geometry.center();
    const casing = new THREE.Mesh(geometry, material);
    return casing;
  };
  return { '556': model('556mm_Shell_Mesh', brass), '9mm': model('9mm_Shell_Mesh', brass), buckshot: model('BuckShot_Shell_Mesh', plastic) };
}

/**
 * Fige une arme animée dans sa pose de repos en un seul maillage (un appel de dessin par texture,
 * sans os) : le fusil d'un bot ne bouge jamais, et ses 9 pièces animées coûtaient 10 appels chacun.
 * Même repère que l'arme d'origine (centimètres, canon vers +x).
 */
function bakeStatic(gun: THREE.Object3D): THREE.Group {
  gun.updateMatrixWorld(true);
  const toGun = gun.matrixWorld.clone().invert();
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const vertex = new THREE.Vector3();
  const tip = new THREE.Vector3();
  gun.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry;
    const matrix = toGun.clone().multiply(child.matrixWorld);
    const materials: THREE.Material[] = Array.isArray(child.material) ? child.material : [child.material];
    const groups = source.groups.length ? source.groups : [{ start: 0, count: source.attributes.position.count, materialIndex: 0 }];
    for (const group of groups) {
      const count = group.count;
      const position = new Float32Array(count * 3);
      const normal = new Float32Array(count * 3);
      const uv = new Float32Array(count * 2);
      const srcPosition = source.attributes.position;
      const srcNormal = source.attributes.normal;
      const srcUv = source.attributes.uv;
      for (let n = 0; n < count; n++) {
        const i = group.start + n;
        // Pièce animée : sommet placé par ses os (pose de repos), puis ramené dans le repère de l'arme.
        vertex.fromBufferAttribute(srcPosition, i);
        tip.copy(vertex).add(new THREE.Vector3().fromBufferAttribute(srcNormal, i));
        if (child instanceof THREE.SkinnedMesh) {
          child.applyBoneTransform(i, vertex);
          child.applyBoneTransform(i, tip);
        }
        vertex.applyMatrix4(matrix);
        tip.applyMatrix4(matrix).sub(vertex).normalize();
        vertex.toArray(position, n * 3);
        tip.toArray(normal, n * 3);
        if (srcUv) uv.set([srcUv.getX(i), srcUv.getY(i)], n * 2);
      }
      const part = new THREE.BufferGeometry();
      part.setAttribute('position', new THREE.BufferAttribute(position, 3));
      part.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      part.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const material = materials[group.materialIndex ?? 0];
      byMaterial.set(material, [...(byMaterial.get(material) ?? []), part]);
    }
  });
  const baked = new THREE.Group();
  for (const [material, parts] of byMaterial) baked.add(new THREE.Mesh(mergeGeometries(parts)!, material));
  return baked;
}

async function loadClips(url: string): Promise<THREE.AnimationClip[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : ${response.status}`);
  const json = (await response.json()) as THREE.AnimationClipJSON[];
  return json.map((clip) => THREE.AnimationClip.parse(clip));
}

/**
 * Oriente l'arme au repos comme dans ses animations : le squelette de la Nova est retourné
 * de 180° dans le FBX (crosse vers l'avant, canon vers le joueur) alors que ses animations
 * de tir et de rechargement le tiennent dans le bon sens.
 */
function alignRestPose(gun: THREE.Object3D, clips: THREE.AnimationClip[]): void {
  const track = clips.flatMap((clip) => clip.tracks).find((t) => t.name.endsWith('_Armature.quaternion'));
  if (!track) return;
  gun.getObjectByName(track.name.slice(0, -'.quaternion'.length))?.quaternion.fromArray(track.values, 0);
}

/** Fixe le chargeur sur son os, orienté comme l'arme au repos. */
function attachMagazine(gun: THREE.Object3D, extra: THREE.Object3D, spec: { mesh: string; bone: string }): void {
  const magazine = extra.getObjectByName(spec.mesh);
  const bone = gun.getObjectByName(spec.bone);
  if (!magazine || !bone) return;
  gun.updateMatrixWorld(true);
  const gunRotation = gun.getWorldQuaternion(new THREE.Quaternion());
  const boneRotation = bone.getWorldQuaternion(new THREE.Quaternion());
  magazine.position.set(0, 0, 0);
  magazine.quaternion.premultiply(boneRotation.invert().multiply(gunRotation));
  bone.add(magazine);
}

/** Matériaux mats, textures en pixels nets, comme le recommande le pack. */
function applyMaterials(
  object: THREE.Object3D,
  textures: { arms: THREE.Texture; gun: THREE.Texture; projectiles: THREE.Texture },
): void {
  for (const texture of Object.values(textures)) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
  }
  const cache = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
  const material = (texture: THREE.Texture) => {
    if (!cache.has(texture)) cache.set(texture, new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }));
    return cache.get(texture)!;
  };

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.frustumCulled = false;
    const pick = (name: string) =>
      material(name.includes('Projectiles') ? textures.projectiles : name.includes('Arms') ? textures.arms : textures.gun);
    child.material = Array.isArray(child.material)
      ? child.material.map((m: THREE.Material) => pick(m.name))
      : pick(child.material.name);
  });
}

const EMPTY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Couteau : mêmes bras en pose « pistolet », couteau dans la main droite, bras gauche masqué. */
function buildKnifeArms(
  armsSource: THREE.Object3D,
  pistolClips: THREE.AnimationClip[],
  textures: { arms: THREE.Texture; gun: THREE.Texture; projectiles: THREE.Texture },
): AnimatedWeapon {
  const arms = cloneSkinned(armsSource);
  applyMaterials(arms, textures);

  const mount = new THREE.Group();
  mount.position.copy(KNIFE_GRIP.position);
  mount.quaternion.copy(knifeOrientation(KNIFE_GRIP.blade));
  const knife = buildKnife();
  knife.scale.setScalar(1 / CM);
  mount.add(knife);
  arms.getObjectByName('hand_item_r')!.add(mount);

  arms.rotation.y = Math.PI / 2;
  arms.scale.setScalar(CM);
  arms.position.copy(VIEW_OFFSET);
  const pose = new THREE.Group();
  pose.rotation.x = KNIFE_POSE.pitch;
  pose.position.copy(KNIFE_POSE.offset);
  pose.add(arms);
  const root = new THREE.Group();
  root.add(pose);
  root.visible = false;

  return new AnimatedWeapon(root, arms, mount, pistolClips, [], [0, 0, 0], [arms.getObjectByName('upperArm_l')!]);
}
