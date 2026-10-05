import * as THREE from 'three';
import { MOVE } from '../config';
import type { Action } from '../core/bindings';
import type { Input } from '../core/Input';
import type { Player } from '../player/Player';
import { LOADOUT, type WeaponDef } from './definitions';

const DEG = Math.PI / 180;
/** Multiplicateur de la dispersion de base accroupi (environ celui de CS). */
const CROUCH_ACCURACY = 0.75;
/** Action qui sort l'arme de chaque emplacement (touches 1, 2, 3 par défaut). */
const SLOT_ACTIONS: Record<number, Action> = { 1: 'weapon1', 2: 'weapon2', 3: 'weapon3' };
/** Rayons du coup de couteau (écarts en radians, gauche/droite et haut/bas) : un éventail étroit. */
const MELEE_FAN: [number, number][] = [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.08], [0, -0.08]];
/** Un coup rapide qui suit une touche de moins de ce temps fait moins mal (CS:GO). */
const COMBO_WINDOW = 0.8;

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
  /** Coup de couteau donné (animation, bruit de lame). */
  swung(def: WeaponDef, kind: MeleeKind): void;
  /** La lame arrive : touche un bot, un mur, ou rien. `combo` : coup enchaîné après une touche. */
  struck(def: WeaponDef, kind: MeleeKind, hit: THREE.Intersection | null, direction: THREE.Vector3, combo: boolean): void;
}

export type MeleeKind = 'light' | 'heavy';

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
  /** Arme rangée : on tient une grenade. */
  holstered = false;
  private pendingStrike: { kind: MeleeKind; timer: number } | null = null;
  private sinceMeleeHit = Infinity;

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
    // Accroupi et au sol, on est plus précis.
    const stance = this.player.crouched && this.player.onGround ? CROUCH_ACCURACY : 1;
    return (
      spread.base * stance +
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
      if (input.consumePress(SLOT_ACTIONS[weapon.def.slot]) && (i !== this.index || this.holstered)) this.equip(i);
    });
    if (this.holstered) {
      this.recoverPunch(dt);
      return;
    }
    if (this.current.def.melee) {
      this.updateMelee(dt, input);
      this.recoverPunch(dt);
      return;
    }

    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.finishReload();
    }
    if (input.consumePress('reload')) this.startReload();

    const pressed = input.consumePress('attack');
    const held = input.isDown('attack');
    const trigger = this.current.def.automatic ? held || pressed : pressed;
    const ready = this.cooldown === 0 && this.reloadTimer <= 0 && this.drawTimer === 0;

    if (trigger && ready) {
      if (this.current.ammo > 0) this.fire();
      else if (this.current.reserve > 0) this.startReload();
      else if (pressed) this.effects.dryFired(this.current.def);
    }

    // La rafale reprend du début si on relâche la gâchette assez longtemps.
    if (!held && this.sinceShot > this.current.def.fireInterval * 1.5) this.shotsFired = 0;

    if (this.sinceShot > this.current.def.fireInterval) this.recoverPunch(dt);
  }

  /** Range l'arme pour sortir une grenade. */
  holster(): void {
    this.holstered = true;
    this.reloadTimer = 0;
  }

  /** Ressort l'arme en cours (après avoir lancé sa dernière grenade). */
  unholster(): void {
    this.equip(this.index);
  }

  /** Le viseur revient en place quand on ne tire plus. */
  private recoverPunch(dt: number): void {
    const decay = Math.exp(-this.current.def.recoil.recovery * dt);
    this.punch.pitch *= decay;
    this.punch.yaw *= decay;
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

  /** Couteau : clic gauche (rapide) ou droit (puissant), la lame touche après un court délai. */
  private updateMelee(dt: number, input: Input): void {
    const melee = this.current.def.melee!;
    this.sinceMeleeHit += dt;
    const light = input.consumePress('attack') || input.isDown('attack');
    const heavy = input.consumePress('attack2') || input.isDown('attack2');

    if (this.pendingStrike) {
      this.pendingStrike.timer -= dt;
      if (this.pendingStrike.timer <= 0) {
        this.strike(this.pendingStrike.kind);
        this.pendingStrike = null;
      }
    }
    if (this.cooldown > 0 || this.drawTimer > 0 || this.pendingStrike) return;

    const kind: MeleeKind | null = heavy ? 'heavy' : light ? 'light' : null;
    if (!kind) return;
    const attack = melee[kind];
    this.cooldown = attack.interval;
    this.pendingStrike = { kind, timer: attack.delay };
    this.effects.swung(this.current.def, kind);
  }

  /** Quelques rayons en éventail devant soi : la lame touche ce qui est le plus proche. */
  private strike(kind: MeleeKind): void {
    const def = this.current.def;
    const attack = def.melee![kind];
    this.player.eyePosition(this.origin);
    this.euler.set(this.player.pitch + this.punch.pitch, this.player.yaw + this.punch.yaw, 0);
    this.aim.setFromEuler(this.euler);

    let best: THREE.Intersection | null = null;
    for (const [yaw, pitch] of MELEE_FAN) {
      this.direction.set(Math.tan(yaw), Math.tan(pitch), -1).normalize().applyQuaternion(this.aim);
      this.raycaster.set(this.origin, this.direction);
      this.raycaster.far = attack.range;
      const hit = this.raycaster.intersectObjects(this.shootables(), false)[0];
      // On préfère un bot à un mur à distance égale : la lame ne rate pas pour un rayon.
      if (hit && (!best || (hit.object.userData.bot && !best.object.userData.bot) || hit.distance < best.distance)) best = hit;
    }
    this.direction.set(0, 0, -1).applyQuaternion(this.aim);
    const combo = kind === 'light' && this.sinceMeleeHit < COMBO_WINDOW;
    if (best?.object.userData.bot) this.sinceMeleeHit = 0;
    this.effects.struck(def, kind, best, this.direction, combo);
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
    this.holstered = false;
    this.pendingStrike = null;
    this.reloadTimer = 0;
    this.drawTimer = this.current.def.drawTime;
    this.shotsFired = 0;
    this.effects.drawn(this.current.def);
  }
}
