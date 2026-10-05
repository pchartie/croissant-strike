import * as THREE from 'three';
import type { WeaponDef, WeaponId } from './definitions';
import { flashSprite } from './flash';
import { MODEL_BUILDERS, type WeaponModel } from './models';
import type { AnimatedWeapon } from './RetroWeapons';

const FLASH_DURATION = 0.05;

export interface ViewModelState {
  /** Vitesse horizontale entre 0 (arrêt) et 1 (course). */
  speed: number;
  onGround: boolean;
  mouseDX: number;
  mouseDY: number;
  reload: number | null;
  draw: number;
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
  private readonly flash = flashSprite();
  private flashTimer = 0;
  private readonly muzzlePosition = new THREE.Vector3();

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
  }

  /** Remplace les armes en blocs par les armes animées (une fois chargées). */
  useAnimated(weapons: Record<WeaponId, AnimatedWeapon>, def: WeaponDef): void {
    this.animated = weapons;
    for (const weapon of Object.values(weapons)) this.scene.add(weapon.root);
    for (const model of Object.values(this.blocks)) model.root.visible = false;
    this.show(def);
  }

  show(def: WeaponDef): void {
    if (this.animated) {
      this.animated[this.currentId].stop();
      this.animated[this.currentId].root.visible = false;
    } else {
      this.blocks[this.currentId].root.visible = false;
    }
    this.currentId = def.id;
    this.kickBack = this.kickPitch = 0;

    if (this.animated) {
      const weapon = this.animated[def.id];
      weapon.root.visible = true;
      weapon.play('draw', def.drawTime);
    } else {
      this.blocks[def.id].root.visible = true;
    }
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

  reload(def: WeaponDef): void {
    this.animated?.[def.id].play('reload', def.reloadTime);
  }

  update(dt: number, state: ViewModelState): void {
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
