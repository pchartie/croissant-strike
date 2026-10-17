import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MOVE } from '../config';
import { flashSprite } from '../weapons/flash';
import { blobShadow, sunShade, sunVisibility } from '../world/sunlight';
import type { Team } from './Bot';

export type HitPart = 'head' | 'body' | 'legs';

/** Multiplicateurs de dégâts de CS selon la zone touchée. */
export const DAMAGE_MULTIPLIER: Record<HitPart, number> = { head: 4, body: 1, legs: 0.75 };

const FLASH_DURATION = 0.05;
/** Délai entre deux tests d'ensoleillement (s), et vitesse de passage ombre ↔ soleil. */
const SUN_CHECK = 0.1;
const SUN_BLEND = 6;
/** Vitesses (m/s) auxquelles les animations de marche et de course ont leur rythme naturel. */
const WALK_PACE = 1.5;
const RUN_PACE = 5;
/** Part gardée du mouvement du bassin dans la marche et la course (sinon le soldat rebondit). */
const HIP_MOTION = 0.4;
/** Part gardée de la flexion du dos des poses de visée (sinon le soldat est voûté). */
const SPINE_BEND = 0.4;
const SPINE_BONES = ['DEF-spine002', 'DEF-spine003'];
/** Durée du recul d'un tir, et vitesse de l'animation de mort. */
const SHOT_TIME = 0.22;
const DEATH_SPEED = 1.6;

/**
 * Tenues (characters/build.py) : les ennemis viennent du nord (spawn CT, casque), les coéquipiers du
 * sud avec le joueur (spawn T, cagoule).
 */
const OUTFIT: Record<Team, string> = { enemy: 'soldier_CT', ally: 'soldier_T' };

/** Os du haut du corps (noms nettoyés par three.js : sans points) : animés par la visée, le tir, le rechargement. */
const UPPER = /^DEF-(spine00[23]|neck|head|shoulder|upper_arm|forearm|hand|f_|thumb)/;

/**
 * Taille d'un motif de tissu dans le repère du modèle (positions compressées : le corps fait environ 2
 * unités de haut, soit à peu près un motif par 25 cm), et force du grain de chaque tissu : sergé, toile, cuir.
 */
const FABRIC_TILE = 1.0;
const FABRIC_STRENGTH = '1.7, 1.9, 1.3';

let fabric: THREE.Texture | null = null;

/**
 * Grain de tissu sur la tenue (characters/build.py range le tissu de chaque partie dans l'alpha de la
 * couleur des sommets) : l'image des tissus (un par canal) est projetée selon les trois axes, sur la
 * pose de repos, pour que le motif suive le corps sans coordonnées de texture.
 */
function addFabric(material: THREE.MeshStandardMaterial): void {
  fabric ??= new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/characters/fabric.webp`, (texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.fabricMap = { value: fabric };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFabricPos;\nvarying vec3 vFabricNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFabricPos = position;\nvFabricNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D fabricMap;\nvarying vec3 vFabricPos;\nvarying vec3 vFabricNormal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 w = pow(abs(normalize(vFabricNormal)), vec3(4.0));
          w /= w.x + w.y + w.z;
          vec3 p = vFabricPos / ${FABRIC_TILE.toFixed(2)};
          vec3 grain = texture2D(fabricMap, p.yz).rgb * w.x + texture2D(fabricMap, p.xz).rgb * w.y + texture2D(fabricMap, p.xy).rgb * w.z;
          float kind = vColor.a * 3.0; // 0 sergé, 1 toile, 2 cuir, 3 lisse
          vec3 pick = vec3(step(kind, 0.5), step(0.5, kind) * step(kind, 1.5), step(1.5, kind) * step(kind, 2.5));
          diffuseColor.rgb *= 1.0 + dot((grain - 0.5) * vec3(${FABRIC_STRENGTH}), pick);
          diffuseColor.a = opacity;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'soldier-fabric';
}

interface SoldierTemplate {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
}

let soldiers: Promise<SoldierTemplate | null> | null = null;

/** Réduit les allers-retours du bassin autour de sa position moyenne (rebond de la foulée). */
function dampHips(clip: THREE.AnimationClip): void {
  const track = clip.tracks.find((t) => t.name === 'DEF-hips.position');
  if (!track) return;
  const values = track.values;
  const keys = values.length / 3;
  for (let axis = 0; axis < 3; axis++) {
    let mean = 0;
    for (let k = 0; k < keys; k++) mean += values[k * 3 + axis] / keys;
    for (let k = 0; k < keys; k++) values[k * 3 + axis] = mean + (values[k * 3 + axis] - mean) * HIP_MOTION;
  }
}

/** Charge les soldats une fois pour tous les bots (public/assets/characters, `npm run build-characters`). */
function loadSoldiers(): Promise<SoldierTemplate | null> {
  soldiers ??= (async () => {
    try {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}assets/characters/soldiers.glb`);
      const clips = new Map<string, THREE.AnimationClip>();
      for (const clip of gltf.animations) {
        if (['walk', 'run', 'crouchWalk'].includes(clip.name)) dampHips(clip);
        // Chaque animation en deux : bas du corps (déplacements) et haut du corps (arme), mélangés à part.
        const part = (upper: boolean) =>
          new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((track) => UPPER.test(track.name) === upper));
        clips.set(`${clip.name}:lower`, part(false));
        clips.set(`${clip.name}:upper`, part(true));
        clips.set(clip.name, clip);
      }
      return { scene: gltf.scene, clips };
    } catch (error) {
      console.info('Soldats absents (npm run build-characters) : bots invisibles.', error);
      return null;
    }
  })();
  return soldiers;
}

const LOWER = ['idle', 'walk', 'run', 'crouchIdle', 'crouchWalk'] as const;
const UPPER_BASE = ['aim', 'aimUp', 'aimDown'] as const;
/**
 * Hors combat, arme basse : le fusil incliné vers le sol (l'animation « arme basse » du pack est une
 * posture au pistolet, buste de côté, qui ne va pas avec un fusil tenu droit devant).
 */
const LOW_READY = -0.35;
/**
 * Bras abaissés dans le mélange des poses de visée (−1 = visée vers le bas) : redresser le dos remonte
 * les bras, qui y sont attachés. Un peu en visée, nettement arme basse.
 */
const AIM_ARMS_BIAS = -0.25;
const LOW_READY_ARMS = -0.65;

export interface PoseOptions {
  /** En combat : arme épaulée, qui suit le regard ; sinon arme basse. */
  aiming?: boolean;
  crouch?: boolean;
}

const hidden = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Soldat animé (mannequin habillé, voir characters/build.py) : déplacements selon la vitesse, haut du
 * corps qui vise et suit le regard, tir, rechargement, mort ; arme dans la main droite. Les zones de
 * touche sont des boîtes fixes (tête, corps, jambes), comme dans CS.
 */
export class BotModel {
  readonly root = new THREE.Group();
  /** Zones de touche invisibles, chacune avec `userData.part` (tête, corps ou jambes). */
  readonly hitboxes: THREE.Mesh[] = [];
  /** Bout du canon : origine des balles et de la flamme. */
  readonly muzzle = new THREE.Object3D();

  private readonly hitGroup = new THREE.Group();
  private readonly flash = flashSprite();
  private flashTimer = 0;
  /** Ombre ronde au sol (la carte n'a pas d'ombres en temps réel). */
  private readonly shadow = blobShadow(0.9);
  /** Matériaux propres à ce modèle (copies), assombris quand il passe à l'ombre. */
  private readonly ownMaterials = new Map<THREE.Material, { material: THREE.MeshStandardMaterial; base: THREE.Color }>();
  private sun = 1;
  private sunTarget = 1;
  private sunTimer = 0;
  private readonly probe = new THREE.Vector3();

  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  /** Bras (os du bras, de l'avant-bras, de la main), posés par IK sur le fusil. */
  private rightArm: Arm | null = null;
  private leftArm: Arm | null = null;
  /** Os du dos et leur rotation debout (au repos), vers laquelle on les redresse. */
  private readonly spine: { bone: THREE.Object3D; upright: THREE.Quaternion }[] = [];
  private gun: THREE.Object3D | null = null;
  private shotTimer = 0;
  private reloadTimer = 0;
  private dying = false;
  private deathStart = 0;
  private pitch = 0;

  constructor(private readonly team: Team = 'enemy') {
    this.root.rotation.order = 'YXZ';
    const box = (size: [number, number, number], center: [number, number, number], part: HitPart) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), hidden);
      mesh.position.set(...center);
      mesh.userData.part = part;
      this.hitGroup.add(mesh);
      this.hitboxes.push(mesh);
    };
    box([0.26, 0.3, 0.28], [0, 1.67, 0], 'head');
    box([0.5, 0.62, 0.32], [0, 1.21, 0], 'body');
    box([0.32, 0.26, 0.5], [0.05, 1.36, -0.3], 'body'); // bras tendus vers l'arme
    box([0.18, 0.9, 0.22], [-0.11, 0.45, 0], 'legs');
    box([0.18, 0.9, 0.22], [0.11, 0.45, 0], 'legs');
    this.root.add(this.hitGroup, this.shadow);
    this.muzzle.add(this.flash);
    void loadSoldiers().then((template) => template && this.attach(template));
  }

  /** Le soldat est chargé : copie du modèle (sa tenue seulement), animations, arme si elle est déjà là. */
  private attach(template: SoldierTemplate): void {
    const body = cloneSkinned(template.scene);
    body.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh) {
        child.visible = child.name === OUTFIT[this.team];
        // Sphère du maillage au repos, doublée pour couvrir toutes les poses (bras tendus, corps
        // allongé à la mort) : un soldat hors du champ de vision n'est plus dessiné.
        child.computeBoundingSphere();
        child.boundingSphere!.radius *= 2;
      }
    });
    // Le modèle regarde vers +z ; le jeu, vers -z.
    body.rotation.y = Math.PI;
    this.root.add(body);
    this.takeMaterials(body);
    body.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh && child.material instanceof THREE.MeshStandardMaterial) addFabric(child.material);
    });
    const arm = (side: 'L' | 'R'): Arm | null => {
      const bones = ['upper_arm', 'forearm', 'hand'].map((name) => body.getObjectByName(`DEF-${name}${side}`));
      return bones.every(Boolean) ? (bones as Arm) : null;
    };
    this.rightArm = arm('R');
    this.leftArm = arm('L');
    for (const name of SPINE_BONES) {
      const bone = body.getObjectByName(name);
      if (bone) this.spine.push({ bone, upright: bone.quaternion.clone() });
    }

    this.mixer = new THREE.AnimationMixer(body);
    const add = (name: string, clip: THREE.AnimationClip | undefined) => {
      if (!clip) return;
      const action = this.mixer!.clipAction(clip);
      action.setEffectiveWeight(0).play();
      this.actions.set(name, action);
    };
    for (const name of LOWER) add(name, template.clips.get(`${name}:lower`));
    for (const name of [...UPPER_BASE, 'shoot', 'reload']) add(name, template.clips.get(`${name}:upper`));
    add('death', template.clips.get('death'));
    const death = this.actions.get('death');
    death?.setLoop(THREE.LoopOnce, 1);
    if (death) death.clampWhenFinished = true;
    if (this.gun) this.root.add(this.gun);
  }

  /** Remplace les matériaux partagés par des copies, que ce modèle peut assombrir seul. */
  private takeMaterials(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || child === this.shadow) return;
      const take = (material: THREE.Material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return material;
        let own = this.ownMaterials.get(material);
        if (!own) {
          const copy = material.clone();
          own = { material: copy, base: copy.color.clone() };
          this.ownMaterials.set(material, own);
        }
        return own.material;
      };
      child.material = Array.isArray(child.material) ? child.material.map(take) : take(child.material);
    });
  }

  /** Ensoleillement : testé de temps en temps (rayons vers le soleil), puis transition douce. */
  private updateSun(position: THREE.Vector3, dt: number): void {
    this.sunTimer -= dt;
    if (this.sunTimer <= 0) {
      this.sunTimer = SUN_CHECK;
      const head = sunVisibility(this.probe.copy(position).setY(position.y + 1.5));
      const knees = sunVisibility(this.probe.copy(position).setY(position.y + 0.5));
      this.sunTarget = (head + knees) / 2;
    }
    const sun = this.sun + (this.sunTarget - this.sun) * Math.min(1, dt * SUN_BLEND);
    if (Math.abs(sun - this.sun) < 1e-3) return;
    this.sun = sun;
    const shade = sunShade(sun);
    for (const { material, base } of this.ownMaterials.values()) material.color.copy(base).multiplyScalar(shade);
    this.shadow.material.opacity = 0.25 + 0.3 * sun;
  }

  /** L'arme du bot (le M4 du pack, en centimètres, canon vers +x), tenue dans la main droite. */
  setGun(gun: THREE.Object3D): void {
    gun.scale.setScalar(0.01);
    this.muzzle.position.set(60, 16.5, 0);
    gun.add(this.muzzle);
    this.gun = gun;
    this.takeMaterials(gun);
    if (this.mixer) this.root.add(gun);
  }

  /** Place le modèle. `speed` (0 à 1, fraction de la vitesse maximale) règle les déplacements. */
  pose(position: THREE.Vector3, yaw: number, pitch: number, speed: number, dt: number, options: PoseOptions = {}): void {
    this.root.position.copy(position);
    this.root.rotation.set(0, yaw, 0);
    this.flashTimer -= dt;
    this.flash.visible = this.flashTimer > 0;
    this.shadow.visible = true;
    if (this.gun) this.gun.visible = true;
    this.hitGroup.scale.y = options.crouch ? 0.72 : 1;
    if (this.dying) {
      // Réapparu : on repart des animations normales.
      this.dying = false;
      this.actions.get('death')?.stop().play().setEffectiveWeight(0);
    }
    this.updateSun(position, dt);
    if (!this.mixer) return;

    // Bas du corps : immobile, marche ou course selon la vitesse (accroupi : immobile ou marche).
    const velocity = speed * MOVE.maxSpeed;
    const walk = THREE.MathUtils.smoothstep(velocity, 0.2, 0.9);
    const run = THREE.MathUtils.smoothstep(velocity, 2.2, 3.4);
    const weights: Record<string, number> = options.crouch
      ? { crouchIdle: 1 - walk, crouchWalk: walk }
      : { idle: 1 - walk, walk: walk * (1 - run), run: walk * run };
    this.actions.get('walk')?.setEffectiveTimeScale(THREE.MathUtils.clamp(velocity / WALK_PACE, 0.6, 1.6));
    this.actions.get('crouchWalk')?.setEffectiveTimeScale(THREE.MathUtils.clamp(velocity / WALK_PACE, 0.6, 1.6));
    this.actions.get('run')?.setEffectiveTimeScale(THREE.MathUtils.clamp(velocity / RUN_PACE, 0.7, 1.8));

    // Haut du corps : visée selon le regard (ou arme basse), avec par-dessus le tir ou le rechargement.
    this.shotTimer = Math.max(0, this.shotTimer - dt);
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    const overlay = this.reloadTimer > 0 ? 'reload' : this.shotTimer > 0 ? 'shoot' : null;
    const base = 1 - (overlay ? 1 : 0);
    // Arme basse : bras abaissés et fusil incliné vers le sol, dos droit.
    this.pitch = options.aiming ? pitch : LOW_READY;
    const tilt = THREE.MathUtils.clamp(options.aiming ? pitch / 0.9 + AIM_ARMS_BIAS : LOW_READY_ARMS, -1, 1);
    weights.aimUp = base * Math.max(tilt, 0);
    weights.aimDown = base * Math.max(-tilt, 0);
    weights.aim = base * (1 - Math.abs(tilt));
    if (overlay) weights[overlay] = 1;

    for (const [name, action] of this.actions) if (name !== 'death') action.setEffectiveWeight(weights[name] ?? 0);
    this.mixer.update(dt);
    for (const { bone, upright } of this.spine) bone.quaternion.slerp(upright, 1 - SPINE_BEND);
    this.holdRifle();
  }

  /**
   * Le fusil épaulé : crosse contre l'épaule droite, pointé là où regarde le bot ; puis les mains posées
   * dessus par IK, la droite sur la poignée, la gauche sur le garde-main (sauf pendant le rechargement,
   * où elle va chercher le chargeur). Les animations du pack tiennent un pistolet, pas un fusil.
   */
  private holdRifle(): void {
    if (!this.gun || !this.rightArm) return;
    this.root.updateMatrixWorld(true);
    // Canon vers +x dans le modèle : le quart de tour le pointe vers -z (l'avant du bot), puis on
    // l'incline selon le regard.
    this.gun.rotation.set(this.pitch, Math.PI / 2, 0, 'XYZ');
    this.gun.updateMatrix();
    const pocket = this.root.worldToLocal(this.rightArm[0].getWorldPosition(ik.a)).add(SHOULDER_POCKET);
    const stock = ik.b.copy(STOCK).multiplyScalar(0.01).applyQuaternion(this.gun.quaternion);
    this.gun.position.copy(pocket).sub(stock);
    this.gun.updateMatrixWorld(true);
    reach(this.rightArm, this.gun.localToWorld(ik.target.copy(RIGHT_WRIST)), RIGHT_ELBOW_HINT, this.root.quaternion);
    if (this.leftArm && this.reloadTimer <= 0) {
      reach(this.leftArm, this.gun.localToWorld(ik.target.copy(LEFT_WRIST)), LEFT_ELBOW_HINT, this.root.quaternion);
    }
  }

  showFlash(): void {
    this.flashTimer = FLASH_DURATION;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.3 + Math.random() * 0.15);
    this.shotTimer = SHOT_TIME;
    this.actions.get('shoot')?.reset().setEffectiveTimeScale(1.5);
  }

  /** Rechargement : l'animation est calée sur sa durée. */
  reload(seconds: number): void {
    const action = this.actions.get('reload');
    if (!action) return;
    this.reloadTimer = seconds;
    action.reset().setEffectiveTimeScale(action.getClip().duration / seconds);
  }

  /** Mort : animation de chute (`progress` sert seulement à savoir qu'elle a commencé). */
  fall(progress: number): void {
    this.flash.visible = false;
    // Couché, l'ombre ronde basculerait avec le corps ; l'arme lâchée disparaît, comme dans CS.
    this.shadow.visible = false;
    if (this.gun) this.gun.visible = false;
    if (!this.mixer) return;
    const now = performance.now() / 1000;
    if (!this.dying || progress === 0) {
      this.dying = true;
      this.deathStart = now;
      for (const action of this.actions.values()) action.setEffectiveWeight(0);
      this.actions.get('death')?.reset().setEffectiveWeight(1).play();
    }
    const death = this.actions.get('death');
    if (death) death.time = Math.min((now - this.deathStart) * DEATH_SPEED, death.getClip().duration);
    this.mixer.update(0);
  }
}

/**
 * Tenue du fusil, dans son repère (cm : canon vers +x, haut +y, gauche du tireur -z) : la crosse contre
 * l'épaule droite, et les poignets, un peu en retrait des prises (la paume est à quelques cm du poignet).
 */
const STOCK = new THREE.Vector3(-21, 13, 0);
const RIGHT_WRIST = new THREE.Vector3(1, 1, 3);
const LEFT_WRIST = new THREE.Vector3(27, 6, -5);
/** La crosse se pose un peu devant et à l'intérieur de l'articulation de l'épaule (repère du bot). */
const SHOULDER_POCKET = new THREE.Vector3(-0.05, -0.03, -0.1);
/** Les coudes plient vers le bas et vers l'extérieur (repère du bot). */
const RIGHT_ELBOW_HINT = new THREE.Vector3(0.25, -0.35, 0);
const LEFT_ELBOW_HINT = new THREE.Vector3(-0.25, -0.35, 0);

const ik = {
  shoulder: new THREE.Vector3(),
  elbow: new THREE.Vector3(),
  wrist: new THREE.Vector3(),
  target: new THREE.Vector3(),
  pole: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  side: new THREE.Vector3(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  parent: new THREE.Quaternion(),
};

type Arm = [THREE.Object3D, THREE.Object3D, THREE.Object3D];

/**
 * IK à deux os : amène le poignet d'un bras sur `target` (monde). On calcule le coude (longueurs du bras
 * gardées, plié du côté de `elbowHint`, dans le repère du bot), puis on tourne le bras vers le coude et
 * l'avant-bras vers la cible. Hors de portée, le bras se tend vers elle.
 */
function reach(arm: Arm, target: THREE.Vector3, elbowHint: THREE.Vector3, facing: THREE.Quaternion): void {
  const [upper, fore, hand] = arm;
  upper.getWorldPosition(ik.shoulder);
  fore.getWorldPosition(ik.elbow);
  hand.getWorldPosition(ik.wrist);
  const upperLength = ik.shoulder.distanceTo(ik.elbow);
  const foreLength = ik.elbow.distanceTo(ik.wrist);
  ik.dir.subVectors(target, ik.shoulder);
  const distance = Math.min(ik.dir.length(), (upperLength + foreLength) * 0.999);
  ik.dir.normalize();
  const goal = ik.target.copy(ik.shoulder).addScaledVector(ik.dir, distance);
  // Coude : à `along` sur la ligne épaule → poignet, écarté de `out` vers l'indice.
  const along = (upperLength * upperLength - foreLength * foreLength + distance * distance) / (2 * distance);
  const out = Math.sqrt(Math.max(upperLength * upperLength - along * along, 0));
  ik.side.copy(elbowHint).applyQuaternion(facing);
  ik.side.addScaledVector(ik.dir, -ik.side.dot(ik.dir)).normalize();
  const elbow = ik.pole.copy(ik.shoulder).addScaledVector(ik.dir, along).addScaledVector(ik.side, out);
  swing(upper, ik.shoulder, ik.elbow, elbow);
  fore.getWorldPosition(ik.elbow);
  hand.getWorldPosition(ik.wrist);
  swing(fore, ik.elbow, ik.wrist, goal);
}

/** Tourne un os (dans le monde) pour que son point `from` aille vers `to`, vus depuis `pivot`. */
function swing(bone: THREE.Object3D, pivot: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3): void {
  ik.a.subVectors(from, pivot).normalize();
  ik.b.subVectors(to, pivot).normalize();
  ik.q.setFromUnitVectors(ik.a, ik.b);
  bone.getWorldQuaternion(ik.parent);
  ik.q.multiply(ik.parent); // rotation voulue dans le monde
  bone.parent!.getWorldQuaternion(ik.parent);
  bone.quaternion.copy(ik.parent.invert().multiply(ik.q));
  bone.updateMatrixWorld(true);
}
