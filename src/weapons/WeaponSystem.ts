import * as THREE from 'three';
import { MOVE } from '../config';
import type { Input } from '../core/Input';
import type { Player } from '../player/Player';
import { LOADOUT, type WeaponDef } from './definitions';

const DEG = Math.PI / 180;

interface WeaponState {
  def: WeaponDef;
  ammo: number;
  reserve: number;
}

/** Ce que le reste du jeu affiche ou joue quand il se passe quelque chose avec l'arme. */
export interface WeaponEffects {
  fired(def: WeaponDef, hit: THREE.Intersection | null, direction: THREE.Vector3): void;
  reloadStarted(def: WeaponDef): void;
  drawn(def: WeaponDef): void;
  dryFired(def: WeaponDef): void;
}

/** Inventaire, tir, rechargement et recul. Tourne au rythme des ticks de physique. */
export class WeaponSystem {
  /** Recul en cours, en radians, ajouté au regard du joueur (positif = haut / gauche). */
  readonly punch = { pitch: 0, yaw: 0 };

  private readonly weapons: WeaponState[] = LOADOUT.map((def) => ({
    def,
    ammo: def.magazine,
    reserve: def.reserve,
  }));
  private index = 0;
  private cooldown = 0;
  private reloadTimer = 0;
  private drawTimer = 0;
  private shotsFired = 0;
  private sinceShot = Infinity;

  private readonly raycaster = new THREE.Raycaster();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly aim = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly player: Player,
    /** Tout ce que les balles peuvent toucher (murs, bots…). */
    private readonly shootables: () => THREE.Object3D[],
    private readonly effects: WeaponEffects,
  ) {
    this.equip(0);
  }

  get current(): WeaponState {
    return this.weapons[this.index];
  }

  /** Avancement du rechargement de 0 à 1, ou null s'il n'y en a pas. */
  get reloadProgress(): number | null {
    return this.reloadTimer > 0 ? 1 - this.reloadTimer / this.current.def.reloadTime : null;
  }

  /** 1 quand l'arme vient d'être sortie, 0 quand elle est prête. */
  get drawProgress(): number {
    return this.drawTimer / this.current.def.drawTime;
  }

  /** Imprécision actuelle en radians. */
  get spread(): number {
    const { spread } = this.current.def;
    const speed = Math.min(this.player.horizontalSpeed / MOVE.maxSpeed, 1);
    return (
      spread.base +
      spread.moving * speed +
      (this.player.onGround ? 0 : spread.air) +
      spread.perShot * Math.min(this.shotsFired, spread.maxShots)
    );
  }

  update(dt: number, input: Input): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.drawTimer = Math.max(0, this.drawTimer - dt);
    this.sinceShot += dt;

    this.weapons.forEach((weapon, i) => {
      if (input.consumePress(`Digit${weapon.def.slot}`) && i !== this.index) this.equip(i);
    });

    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.finishReload();
    }
    if (input.consumePress('KeyR')) this.startReload();

    const pressed = input.consumePress('Mouse0');
    const held = input.isDown('Mouse0');
    const trigger = this.current.def.automatic ? held || pressed : pressed;
    const ready = this.cooldown === 0 && this.reloadTimer <= 0 && this.drawTimer === 0;

    if (trigger && ready) {
      if (this.current.ammo > 0) this.fire();
      else if (this.current.reserve > 0) this.startReload();
      else if (pressed) this.effects.dryFired(this.current.def);
    }

    // La rafale reprend du début si on relâche la gâchette assez longtemps.
    if (!held && this.sinceShot > this.current.def.fireInterval * 1.5) this.shotsFired = 0;

    // Le viseur revient en place quand on ne tire plus.
    const { def } = this.current;
    if (this.sinceShot > def.fireInterval) {
      const decay = Math.exp(-def.recoil.recovery * dt);
      this.punch.pitch *= decay;
      this.punch.yaw *= decay;
    }
  }

  private fire(): void {
    const weapon = this.current;
    const { def } = weapon;
    weapon.ammo--;
    this.cooldown = def.fireInterval;
    this.sinceShot = 0;

    // La balle part là où pointe le réticule (regard + recul), avec une dispersion aléatoire.
    this.euler.set(this.player.pitch + this.punch.pitch, this.player.yaw + this.punch.yaw, 0);
    this.aim.setFromEuler(this.euler);
    this.direction.set(0, 0, -1).applyQuaternion(this.aim);
    this.right.set(1, 0, 0).applyQuaternion(this.aim);
    this.up.set(0, 1, 0).applyQuaternion(this.aim);

    const radius = Math.tan(this.spread * Math.random());
    const angle = Math.random() * Math.PI * 2;
    this.direction
      .addScaledVector(this.right, Math.cos(angle) * radius)
      .addScaledVector(this.up, Math.sin(angle) * radius)
      .normalize();

    this.raycaster.set(this.player.eyePosition(this.origin), this.direction);
    this.raycaster.far = def.range;
    const hit = this.raycaster.intersectObjects(this.shootables(), false)[0] ?? null;
    this.effects.fired(def, hit, this.direction);

    // Le recul s'applique après le tir : la première balle part toujours au centre.
    const { pattern, random } = def.recoil;
    const [kickUp, kickRight] = pattern[Math.min(this.shotsFired, pattern.length - 1)];
    this.punch.pitch += kickUp * DEG;
    this.punch.yaw -= (kickRight + (Math.random() - 0.5) * random) * DEG;
    this.shotsFired++;
  }

  private startReload(): void {
    const weapon = this.current;
    if (this.reloadTimer > 0 || this.drawTimer > 0) return;
    if (weapon.ammo === weapon.def.magazine || weapon.reserve === 0) return;
    this.reloadTimer = weapon.def.reloadTime;
    this.effects.reloadStarted(weapon.def);
  }

  private finishReload(): void {
    const weapon = this.current;
    const taken = Math.min(weapon.def.magazine - weapon.ammo, weapon.reserve);
    weapon.ammo += taken;
    weapon.reserve -= taken;
    this.reloadTimer = 0;
  }

  /** Recharge toutes les armes et ressort la première (à la réapparition). */
  reset(): void {
    for (const weapon of this.weapons) {
      weapon.ammo = weapon.def.magazine;
      weapon.reserve = weapon.def.reserve;
    }
    this.punch.pitch = this.punch.yaw = 0;
    this.equip(0);
  }

  private equip(index: number): void {
    this.index = index;
    this.reloadTimer = 0;
    this.drawTimer = this.current.def.drawTime;
    this.shotsFired = 0;
    this.effects.drawn(this.current.def);
  }
}
