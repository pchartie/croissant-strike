import * as THREE from 'three';
import { flashSprite } from '../weapons/flash';
import { blobShadow, sunShade, sunVisibility } from '../world/sunlight';
import type { Team } from './Bot';

export type HitPart = 'head' | 'body' | 'legs';

/** Multiplicateurs de dégâts de CS selon la zone touchée. */
export const DAMAGE_MULTIPLIER: Record<HitPart, number> = { head: 4, body: 1, legs: 0.75 };

const HIP = 0.88;
const SHOULDER = 1.42;
const FLASH_DURATION = 0.05;
/** Délai entre deux tests d'ensoleillement (s), et vitesse de passage ombre ↔ soleil. */
const SUN_CHECK = 0.1;
const SUN_BLEND = 6;

/** Tenues : beige et cagoule noire pour les ennemis, bleu-gris et casque pour les coéquipiers (comme les CT). */
const OUTFITS = {
  enemy: { shirt: 0x8a7a5a, vest: 0x4a4f3a, pants: 0x3b3a35, head: 0x222222 },
  ally: { shirt: 0x3b4a5c, vest: 0x2a3540, pants: 0x2b3038, head: 0x3d4652 },
};
const outfitMaterials = (team: Team) => {
  const colors = OUTFITS[team];
  const material = (color: number, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness });
  return { shirt: material(colors.shirt), vest: material(colors.vest, 0.85), pants: material(colors.pants), head: material(colors.head, 0.95) };
};
const MATERIALS = { enemy: outfitMaterials('enemy'), ally: outfitMaterials('ally') };
const skin = new THREE.MeshStandardMaterial({ color: 0xc89c7c, roughness: 0.8 });
const gunMetal = new THREE.MeshStandardMaterial({ color: 0x1e1f21, metalness: 0.6, roughness: 0.5 });
const gunWood = new THREE.MeshStandardMaterial({ color: 0x6e3d1e, roughness: 0.7 });

/**
 * Silhouette de bot en blocs : jambes animées, buste, tête et bras qui
 * suivent la visée. Les blocs du corps servent aussi de zones de touche.
 */
export class BotModel {
  readonly root = new THREE.Group();
  /** Blocs touchables, chacun avec `userData.part` (tête, corps ou jambes). */
  readonly hitboxes: THREE.Mesh[] = [];
  readonly muzzle = new THREE.Object3D();

  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly arms = new THREE.Group();
  /** Arme en blocs, cachée quand le vrai fusil est chargé. */
  private readonly blockGun: THREE.Mesh[] = [];
  private readonly flash = flashSprite();
  private flashTimer = 0;
  private walkPhase = 0;
  /** Ombre ronde au sol (la carte n'a pas d'ombres en temps réel). */
  private readonly shadow = blobShadow(0.9);
  /** Matériaux propres à ce modèle (copies), assombris quand il passe à l'ombre. */
  private readonly ownMaterials = new Map<THREE.Material, { material: THREE.MeshStandardMaterial; base: THREE.Color }>();
  private sun = 1;
  private sunTarget = 1;
  private sunTimer = 0;
  private readonly probe = new THREE.Vector3();

  constructor(team: Team = 'enemy') {
    const { shirt, vest, pants, head } = MATERIALS[team];
    // Lacet d'abord, puis bascule : le bot tombe en arrière par rapport à là où il regarde.
    this.root.rotation.order = 'YXZ';
    for (const [leg, x] of [[this.leftLeg, -0.11], [this.rightLeg, 0.11]] as const) {
      leg.position.set(x, HIP, 0);
      this.box(leg, pants, [0.17, HIP, 0.2], [0, -HIP / 2, 0], 'legs');
      this.root.add(leg);
    }

    this.box(this.root, shirt, [0.46, 0.62, 0.26], [0, HIP + 0.31, 0], 'body');
    this.box(this.root, vest, [0.48, 0.4, 0.28], [0, HIP + 0.36, 0], 'body');
    this.box(this.root, head, [0.24, 0.26, 0.26], [0, 1.63, 0], 'head');
    this.box(this.root, skin, [0.2, 0.06, 0.02], [0, 1.65, -0.13]); // fente des yeux

    // Bras et arme, inclinés selon la visée.
    this.arms.position.set(0, SHOULDER, 0);
    this.box(this.arms, shirt, [0.12, 0.12, 0.42], [0.2, -0.08, -0.18], 'body');
    this.box(this.arms, shirt, [0.12, 0.12, 0.5], [-0.1, -0.12, -0.26], 'body');
    this.blockGun.push(
      this.box(this.arms, gunMetal, [0.06, 0.09, 0.55], [0.05, -0.12, -0.5]),
      this.box(this.arms, gunWood, [0.05, 0.08, 0.22], [0.05, -0.15, -0.12]),
      this.box(this.arms, gunMetal, [0.04, 0.15, 0.06], [0.05, -0.22, -0.42]),
    );
    this.muzzle.position.set(0.05, -0.12, -0.85);
    this.muzzle.add(this.flash);
    this.arms.add(this.muzzle);
    this.root.add(this.arms);

    this.root.add(this.shadow);
    this.takeMaterials(this.root);
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

  private box(
    parent: THREE.Object3D,
    material: THREE.Material,
    size: [number, number, number],
    position: [number, number, number],
    part?: HitPart,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    parent.add(mesh);
    if (part) {
      mesh.userData.part = part;
      this.hitboxes.push(mesh);
    }
    return mesh;
  }

  /** Remplace l'arme en blocs par un vrai modèle (le M4 du pack, en centimètres, canon vers +x). */
  setGun(gun: THREE.Object3D): void {
    for (const mesh of this.blockGun) mesh.visible = false;
    gun.scale.setScalar(0.01);
    gun.rotation.y = Math.PI / 2;
    // Poignée dans la main droite, canon à hauteur de l'ancienne arme.
    gun.position.set(0.05, -0.285, -0.25);
    this.takeMaterials(gun);
    this.arms.add(gun);
  }

  /** Place le modèle. `speed` (0 à 1) règle le balancement des jambes. */
  pose(position: THREE.Vector3, yaw: number, pitch: number, speed: number, dt: number): void {
    this.root.position.copy(position);
    this.root.rotation.set(0, yaw, 0);
    this.arms.rotation.x = pitch;

    this.walkPhase += dt * 9 * speed;
    const swing = Math.sin(this.walkPhase) * 0.6 * speed;
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;

    this.flashTimer -= dt;
    this.flash.visible = this.flashTimer > 0;
    this.shadow.visible = true;
    this.updateSun(position, dt);
  }

  showFlash(): void {
    this.flashTimer = FLASH_DURATION;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.3 + Math.random() * 0.15);
  }

  /** Chute en arrière : `progress` va de 0 (debout) à 1 (au sol). */
  fall(progress: number): void {
    const t = 1 - (1 - progress) * (1 - progress);
    this.root.rotation.x = (Math.PI / 2) * t;
    this.arms.rotation.x = -0.6 * t;
    this.flash.visible = false;
    // Couché, l'ombre ronde basculerait avec le corps.
    this.shadow.visible = false;
  }
}
