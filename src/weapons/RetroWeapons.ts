import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { WeaponId } from './definitions';
import { buildKnife } from './models';

// Armes et bras animés du Retro Weapon Pack, préparés par
// `npm run import-weapons` dans public/assets/weapons/.

const BASE = `${import.meta.env.BASE_URL}assets/weapons/`;
/** Le pack est en centimètres. */
const CM = 0.01;
/** Vitesse de fondu entre les animations (par seconde). */
const BLEND_RATE = 18;
/** Décalage de l'arme en main (mètres) : un peu à droite et vers le bas pour dégager le réticule. */
const VIEW_OFFSET = new THREE.Vector3(0.02, -0.015, 0);

interface GunSpec {
  /** Nom des fichiers (fusil : rifle.fbx, rifle-extra.fbx, arms-rifle.json…). */
  file: string;
  /** Pièce de `<file>-extra.fbx` qui sert de chargeur. */
  magazine: string;
  /** Os où fixer le chargeur (Main = l'arme elle-même). */
  magazineBone: string;
  /** Bout du canon, dans le repère de l'arme, en cm. */
  muzzle: [number, number, number];
}

type GunId = Exclude<WeaponId, 'knife'>;

const GUNS: Record<GunId, GunSpec> = {
  rifle: { file: 'rifle', magazine: 'Rifle_01_Magazine_2+Bullets', magazineBone: 'Magazine', muzzle: [60, 16.5, 0] },
  pistol: { file: 'pistol', magazine: 'Pistol_01_Magazine_Full_Mesh', magazineBone: 'Main', muzzle: [19.2, 12, 0] },
};

/**
 * Couteau dans la main droite (repère de l'os hand_item_r, en cm) : le manche suit
 * l'axe de la poignée du pistolet, incliné de 20° vers l'avant.
 */
const KNIFE_GRIP = { position: new THREE.Vector3(0.8, 4.5, 0), tilt: -0.35 };
/** Bras inclinés pour que la lame pointe vers l'avant, comme dans CS:GO (rotation et décalage en mètres). */
const KNIFE_POSE = { pitch: -0.4, offset: new THREE.Vector3(0.05, 0.18, -0.06) };

type OneShot = 'fire' | 'reload' | 'draw';

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

    for (const name of ['idle', 'walk']) this.arms[name].play();
    for (const name of ['fire', 'reload', 'draw']) {
      this.arms[name].setLoop(THREE.LoopOnce, 1);
      this.arms[name].clampWhenFinished = true;
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
    // Le tir n'interrompt pas un rechargement ou une sortie d'arme.
    if (name === 'fire' && (this.oneShot === 'reload' || this.oneShot === 'draw') && this.arms[this.oneShot].isRunning()) return;
    if (this.oneShot && this.oneShot !== name) this.arms[this.oneShot].stop();

    this.oneShot = name;
    const action = this.arms[name];
    action.reset();
    action.timeScale = duration ? action.getClip().duration / duration : 1;
    action.play();
    if (name === 'draw') this.override = 1;

    const gunAction = this.gun[name];
    if (gunAction) {
      gunAction.reset();
      gunAction.timeScale = duration ? gunAction.getClip().duration / duration : 1;
      gunAction.play();
    }
  }

  /** Arrête tout (changement d'arme). */
  stop(): void {
    if (this.oneShot) this.arms[this.oneShot].stop();
    this.oneShot = null;
    this.gunMixer.stopAllAction();
  }

  update(dt: number, speed: number, onGround: boolean): void {
    // Repos ↔ marche selon la vitesse du joueur.
    const targetWalk = onGround ? speed : 0;
    this.walk += (targetWalk - this.walk) * Math.min(1, dt * 8);
    this.arms.walk.timeScale = 0.6 + 0.6 * this.walk;

    // Une fois l'animation ponctuelle finie, elle reste figée sur sa dernière
    // image pendant qu'on revient en fondu vers l'animation de base.
    const current = this.oneShot ? this.arms[this.oneShot] : null;
    const active = current !== null && current.isRunning();
    this.override += ((active ? 1 : 0) - this.override) * Math.min(1, dt * BLEND_RATE);
    if (current && !active && this.override < 0.01) {
      current.stop();
      this.oneShot = null;
    }

    const base = 1 - this.override;
    this.arms.idle.setEffectiveWeight(base * (1 - this.walk));
    this.arms.walk.setEffectiveWeight(base * this.walk);
    current?.setEffectiveWeight(this.override);

    this.armsMixer.update(dt);
    this.gunMixer.update(dt);
    for (const bone of this.hiddenBones) bone.scale.setScalar(1e-3);
  }
}

/** Charge les armes animées, ou renvoie null si les fichiers n'ont pas été importés. */
export interface RetroWeapons {
  /** Bras + arme animés, pour la vue à la première personne. */
  viewModels: Record<WeaponId, AnimatedWeapon>;
  /** Fusil seul (avec chargeur), à cloner pour les bots. */
  botRifle: THREE.Object3D;
}

export async function loadRetroWeapons(): Promise<RetroWeapons | null> {
  try {
    const manager = new THREE.LoadingManager();
    // Les textures référencées dans les FBX sont remplacées plus bas : on ne les télécharge pas.
    manager.setURLModifier((url) => (/\.(png|jpe?g|tga)$/i.test(url) && !url.includes('/assets/weapons/') ? EMPTY_PNG : url));
    const fbx = new FBXLoader(manager);
    const textures = new THREE.TextureLoader();

    const [armsSource, armsTexture, projectilesTexture] = await Promise.all([
      fbx.loadAsync(`${BASE}arms.fbx`),
      textures.loadAsync(`${BASE}arms.png`),
      textures.loadAsync(`${BASE}projectiles.png`),
    ]);

    const viewModels = {} as Record<WeaponId, AnimatedWeapon>;
    let botRifle: THREE.Object3D | null = null;
    let pistolClips: THREE.AnimationClip[] = [];
    for (const id of Object.keys(GUNS) as GunId[]) {
      const spec = GUNS[id];
      const [gun, extra, gunTexture, armsClips, gunClips] = await Promise.all([
        fbx.loadAsync(`${BASE}${spec.file}.fbx`),
        fbx.loadAsync(`${BASE}${spec.file}-extra.fbx`),
        textures.loadAsync(`${BASE}${spec.file}.png`),
        loadClips(`${BASE}arms-${spec.file}.json`),
        loadClips(`${BASE}${spec.file}-anims.json`),
      ]);

      const materials = { arms: armsTexture, gun: gunTexture, projectiles: projectilesTexture };
      attachMagazine(gun, extra, spec);
      applyMaterials(gun, materials);
      if (id === 'rifle') botRifle = cloneSkinned(gun);
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
    return { viewModels, botRifle: botRifle! };
  } catch (error) {
    console.info('Armes animées absentes, modèles simples utilisés. Lancer `npm run import-weapons`.', error);
    return null;
  }
}

async function loadClips(url: string): Promise<THREE.AnimationClip[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : ${response.status}`);
  const json = (await response.json()) as THREE.AnimationClipJSON[];
  return json.map((clip) => THREE.AnimationClip.parse(clip));
}

/** Fixe le chargeur sur son os, orienté comme l'arme au repos. */
function attachMagazine(gun: THREE.Object3D, extra: THREE.Object3D, spec: GunSpec): void {
  const magazine = extra.getObjectByName(spec.magazine);
  const bone = gun.getObjectByName(spec.magazineBone);
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
  mount.rotation.z = KNIFE_GRIP.tilt;
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
