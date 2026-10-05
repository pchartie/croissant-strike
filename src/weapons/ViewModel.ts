import * as THREE from 'three';
import type { WeaponDef, WeaponId } from './definitions';
import type { MeleeKind, ReloadPhase } from './WeaponSystem';
import { flashSprite } from './flash';
import { MODEL_BUILDERS, type WeaponModel } from './models';
import type { AnimatedWeapon } from './RetroWeapons';
import { GRENADE_ORDER, type GrenadeType } from '../grenades/definitions';
import { buildGrenadeModel } from '../grenades/models';

const FLASH_DURATION = 0.05;
/** Durée des animations de coup de couteau (secondes). */
const LIGHT_SWING_TIME = 0.38;
const HEAVY_SWING_TIME = 0.8;

export interface ViewModelState {
  /** Vitesse horizontale entre 0 (arrêt) et 1 (course). */
  speed: number;
  onGround: boolean;
  mouseDX: number;
  mouseDY: number;
  reload: number | null;
  draw: number;
  /** Grenade en main (sortie, dégoupillée, en train d'être lancée), ou null. */
  grenade: { draw: number; pulled: boolean; throwing: number | null } | null;
}

/**
 * L'arme en main. Elle a sa propre scène et sa propre caméra, dessinées
 * par-dessus le monde : elle ne rentre donc jamais dans les murs.
 *
 * Si les armes du Retro Weapon Pack ont été importées, on affiche les bras
 * animés ; sinon, des armes en blocs animées par le code.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);

  private readonly blocks = {} as Record<WeaponId, WeaponModel>;
  private animated: Record<WeaponId, AnimatedWeapon> | null = null;
  private currentId: WeaponId = 'rifle';
  private readonly grenades = {} as Record<GrenadeType, THREE.Group>;
  /** Grenade en main, ou null si on tient une arme à feu. */
  private grenadeType: GrenadeType | null = null;
  private readonly flash = flashSprite();
  private flashTimer = 0;
  private readonly muzzlePosition = new THREE.Vector3();

  private knifeSwing: { kind: MeleeKind; time: number } | null = null;
  private bobPhase = 0;
  private bobAmount = 0;
  private swayX = 0;
  private swayY = 0;
  private kickBack = 0;
  private kickPitch = 0;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x4a4035, 2.2));
    const key = new THREE.DirectionalLight(0xfff1d6, 2.2);
    key.position.set(1, 2, 1.5);
    this.scene.add(key);

    for (const id of Object.keys(MODEL_BUILDERS) as WeaponId[]) {
      const model = MODEL_BUILDERS[id]();
      model.root.visible = false;
      this.scene.add(model.root);
      this.blocks[id] = model;
    }
    this.scene.add(this.flash);

    for (const type of GRENADE_ORDER) {
      const model = buildGrenadeModel(type);
      model.visible = false;
      this.scene.add(model);
      this.grenades[type] = model;
    }
  }

  /** Remplace les armes en blocs par les armes animées (une fois chargées). */
  useAnimated(weapons: Record<WeaponId, AnimatedWeapon>, def: WeaponDef): void {
    this.animated = weapons;
    for (const weapon of Object.values(weapons)) this.scene.add(weapon.root);
    for (const model of Object.values(this.blocks)) model.root.visible = false;
    this.show(def);
  }

  show(def: WeaponDef): void {
    this.hideGrenade();
    if (this.animated) {
      this.animated[this.currentId].stop();
      this.animated[this.currentId].root.visible = false;
    } else {
      this.blocks[this.currentId].root.visible = false;
    }
    this.currentId = def.id;
    this.kickBack = this.kickPitch = 0;
    this.knifeSwing = null;

    if (this.animated) {
      const weapon = this.animated[def.id];
      weapon.root.visible = true;
      weapon.play('draw', def.drawTime);
    } else {
      this.blocks[def.id].root.visible = true;
    }
  }

  /** Sort une grenade : l'arme à feu disparaît. */
  showGrenade(type: GrenadeType): void {
    this.hideGrenade();
    if (this.animated) this.animated[this.currentId].root.visible = false;
    else this.blocks[this.currentId].root.visible = false;
    this.grenadeType = type;
    this.grenades[type].visible = true;
  }

  private hideGrenade(): void {
    if (this.grenadeType) this.grenades[this.grenadeType].visible = false;
    this.grenadeType = null;
  }

  /** Grenade en main : remonte à la sortie, recule une fois dégoupillée, part vers l'avant au lancer. */
  private poseGrenade(pose: { draw: number; pulled: boolean; throwing: number | null }): void {
    const model = this.grenades[this.grenadeType!];
    model.position.set(0.14, -0.16, -0.32);
    model.rotation.set(0.2, -0.3, 0.15);
    const draw = pose.draw * pose.draw;
    model.position.y -= 0.25 * draw;
    if (pose.pulled) {
      model.position.add(new THREE.Vector3(0.03, 0.06, 0.08));
      model.rotation.x -= 0.5;
    }
    if (pose.throwing !== null) {
      const t = pose.throwing;
      model.position.z -= 0.6 * t;
      model.position.y += 0.1 * Math.sin(Math.PI * t);
      model.visible = t < 0.35;
    } else {
      model.visible = true;
    }
  }

  /** Coup de couteau : balayage de droite à gauche (rapide) ou coup de pointe (puissant). */
  swing(kind: MeleeKind): void {
    this.knifeSwing = { kind, time: 0 };
  }

  kick(def: WeaponDef): void {
    // Les bras animés ont leur propre recul : on n'ajoute qu'un léger à-coup.
    const scale = this.animated ? 0.3 : 1;
    this.kickBack += def.viewKick.back * scale;
    this.kickPitch += def.viewKick.pitch * scale;
    this.animated?.[def.id].play('fire');

    this.flashTimer = FLASH_DURATION;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar((this.animated ? 0.16 : 0.12) + Math.random() * 0.08);
  }

  /** Étape de rechargement : chargeur entier, ou début / cartouche / fin pour le fusil à pompe. */
  reload(def: WeaponDef, phase: ReloadPhase, duration: number): void {
    const clip = phase === 'full' ? 'reload' : `reload${phase[0].toUpperCase()}${phase.slice(1)}`;
    this.animated?.[def.id].play(clip, duration);
  }

  update(dt: number, state: ViewModelState): void {
    if (this.knifeSwing) this.knifeSwing.time += dt;
    if (this.grenadeType && state.grenade) {
      this.poseGrenade(state.grenade);
      this.flash.visible = false;
      return;
    }
    // L'arme traîne un peu derrière les mouvements de la souris.
    const follow = Math.min(1, dt * 10);
    this.swayX += (THREE.MathUtils.clamp(-state.mouseDX * 0.0004, -0.03, 0.03) - this.swayX) * follow;
    this.swayY += (THREE.MathUtils.clamp(state.mouseDY * 0.0004, -0.03, 0.03) - this.swayY) * follow;

    const recover = Math.exp(-dt * 14);
    this.kickBack *= recover;
    this.kickPitch *= recover;

    if (this.animated) {
      const weapon = this.animated[this.currentId];
      weapon.root.position.set(this.swayX, this.swayY, this.kickBack);
      weapon.root.rotation.set(this.kickPitch, 0, 0);
      this.applySwing(weapon.root);
      weapon.update(dt, state.speed, state.onGround);
      this.updateFlash(dt, weapon.muzzle);
      return;
    }

    // Armes en blocs : balancement, rechargement et sortie animés par le code.
    const targetBob = state.onGround ? state.speed : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 8);
    this.bobPhase += dt * 11 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase) * 0.012 * this.bobAmount;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.01 * this.bobAmount;

    const { root, rest, muzzle } = this.blocks[this.currentId];
    root.position.set(rest.x + bobX + this.swayX, rest.y + bobY + this.swayY, rest.z + this.kickBack);
    root.rotation.set(this.kickPitch, 0, 0);
    this.applySwing(root);

    // Rechargement : l'arme plonge et pivote, puis revient.
    if (state.reload !== null) {
      const dip = Math.sin(Math.PI * state.reload);
      root.position.y -= 0.12 * dip;
      root.rotation.x -= 0.5 * dip;
      root.rotation.z += 0.4 * dip;
    }

    // Sortie de l'arme : elle remonte depuis le bas de l'écran.
    const draw = state.draw * state.draw;
    root.position.y -= 0.25 * draw;
    root.rotation.x -= 0.8 * draw;

    this.updateFlash(dt, muzzle);
  }

  /** Ajoute le mouvement du coup de couteau en cours à la pose de l'arme. */
  private applySwing(root: THREE.Object3D): void {
    const swing = this.knifeSwing;
    if (!swing) return;
    const duration = swing.kind === 'light' ? LIGHT_SWING_TIME : HEAVY_SWING_TIME;
    const p = swing.time / duration;
    if (p >= 1) {
      this.knifeSwing = null;
      return;
    }

    if (swing.kind === 'light') {
      // Balayage : la lame part de la droite et traverse vers la gauche en s'inclinant.
      const arc = Math.sin(Math.PI * p);
      const sweep = 0.55 - 1.3 * THREE.MathUtils.smootherstep(p, 0, 1);
      root.rotation.y += sweep * arc;
      root.rotation.z -= 0.6 * arc;
      root.rotation.x += 0.15 * arc;
      root.position.z -= 0.06 * arc;
      return;
    }

    // Coup de pointe : on arme vers l'arrière, on frappe vers l'avant, puis on revient.
    let back: number;
    if (p < 0.45) back = Math.sin((p / 0.45) * (Math.PI / 2));
    else if (p < 0.6) back = 1 - 3.5 * ((p - 0.45) / 0.15);
    else back = -2.5 * (1 - THREE.MathUtils.smootherstep(p, 0.6, 1));
    root.position.z += 0.07 * back;
    root.position.y += 0.03 * Math.max(back, 0);
    root.rotation.x += 0.3 * back;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private updateFlash(dt: number, muzzle: THREE.Object3D): void {
    this.flashTimer -= dt;
    this.flash.visible = this.flashTimer > 0;
    if (this.flash.visible) {
      this.scene.updateMatrixWorld();
      this.flash.position.copy(muzzle.getWorldPosition(this.muzzlePosition));
    }
  }
}
