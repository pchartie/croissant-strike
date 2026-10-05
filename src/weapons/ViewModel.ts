import * as THREE from 'three';
import type { WeaponDef, WeaponId } from './definitions';
import { flashSprite } from './flash';
import { MODEL_BUILDERS, type WeaponModel } from './models';

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
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);

  private readonly models = {} as Record<WeaponId, WeaponModel>;
  private current: WeaponModel;
  private readonly flash: THREE.Sprite;
  private flashTimer = 0;

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
      this.models[id] = model;
    }

    this.flash = flashSprite();
    this.current = this.models.rifle;
  }

  show(id: WeaponId): void {
    this.current.root.visible = false;
    this.current = this.models[id];
    this.current.root.visible = true;
    this.current.muzzle.add(this.flash);
    this.kickBack = this.kickPitch = 0;
  }

  kick(def: WeaponDef): void {
    this.kickBack += def.viewKick.back;
    this.kickPitch += def.viewKick.pitch;
    this.flashTimer = FLASH_DURATION;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.12 + Math.random() * 0.08);
  }

  update(dt: number, state: ViewModelState): void {
    // Balancement de la marche.
    const targetBob = state.onGround ? state.speed : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 8);
    this.bobPhase += dt * 11 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase) * 0.012 * this.bobAmount;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.01 * this.bobAmount;

    // L'arme traîne un peu derrière les mouvements de la souris.
    const follow = Math.min(1, dt * 10);
    this.swayX += (THREE.MathUtils.clamp(-state.mouseDX * 0.0004, -0.03, 0.03) - this.swayX) * follow;
    this.swayY += (THREE.MathUtils.clamp(state.mouseDY * 0.0004, -0.03, 0.03) - this.swayY) * follow;

    const recover = Math.exp(-dt * 14);
    this.kickBack *= recover;
    this.kickPitch *= recover;

    const { root, rest } = this.current;
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

    this.flashTimer -= dt;
    this.flash.visible = this.flashTimer > 0;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
