import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Player } from '../player/Player';
import {
  DECOY,
  GRENADE_CARRY,
  GRENADE_LOADOUT,
  GRENADE_ORDER,
  GRENADE_PHYSICS,
  GRENADES,
  MOLOTOV,
  SMOKE,
  type GrenadeDef,
  type GrenadeType,
} from './definitions';
import { Explosion, FireArea, Scorch, SmokeCloud } from './effects';
import { Projectile, type GrenadeOwner } from './Projectile';

const DEG = Math.PI / 180;
const DRAW_TIME = 0.4;
/** Temps minimal pour dégoupiller avant de pouvoir lancer. */
const PIN_TIME = 0.2;
const THROW_TIME = 0.45;

type State = 'drawing' | 'ready' | 'pulled' | 'throwing';

/** Ce que le jeu fait quand il se passe quelque chose avec une grenade. */
export interface GrenadeHooks {
  /** Obstacles sur lesquels les grenades rebondissent (murs, corps). */
  colliders(): readonly THREE.Box3[];
  /** Vrai si aucun mur ne sépare deux points. */
  lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean;
  /** Hauteur du sol sous un point (pour un molotov qui éclate en l'air). */
  floorBelow(position: THREE.Vector3): number;
  pulled(def: GrenadeDef): void;
  thrown(def: GrenadeDef): void;
  /** Plus de grenade de ce type en main : le jeu ressort l'arme. */
  emptyHanded(): void;
  bounce(position: THREE.Vector3, speed: number): void;
  /** `owner` : null si c'est la grenade du joueur, sinon le bot qui l'a lancée. */
  explode(position: THREE.Vector3, owner: GrenadeOwner | null): void;
  flashbang(position: THREE.Vector3, owner: GrenadeOwner | null): void;
  smoke(position: THREE.Vector3): void;
  fire(position: THREE.Vector3, fizzled: boolean): void;
  decoyShot(position: THREE.Vector3): void;
  decoyEnded(position: THREE.Vector3): void;
}

interface Decoy {
  projectile: Projectile;
  time: number;
  burstLeft: number;
  nextShot: number;
}

/**
 * Grenades de CS:GO : inventaire, lancer (clic gauche loin, clic droit en
 * cloche, les deux à mi-distance), vol avec rebonds et effets au sol.
 */
export class GrenadeSystem {
  readonly counts = { ...GRENADE_LOADOUT };
  /** Type en main, ou null si on tient une arme à feu. */
  current: GrenadeType | null = null;

  private state: State = 'drawing';
  private timer = 0;
  private heldMask = 0;

  private readonly projectiles: Projectile[] = [];
  private readonly decoys: Decoy[] = [];
  private readonly smokes: SmokeCloud[] = [];
  private readonly fires: FireArea[] = [];
  private readonly explosions: Explosion[] = [];
  private readonly scorches: Scorch[] = [];
  /** Lumières créées une fois pour toutes (en ajouter en cours de jeu fait saccader). */
  private readonly flashLight = new THREE.PointLight(0xffc27a, 0, 20, 2);
  private readonly fireLight = new THREE.PointLight(0xff7a2a, 0, 12, 2);

  private readonly eye = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly scene: THREE.Scene,
    private readonly player: Player,
    private readonly hooks: GrenadeHooks,
  ) {
    scene.add(this.flashLight, this.fireLight);
  }

  get def(): GrenadeDef | null {
    return this.current ? GRENADES[this.current] : null;
  }

  /** Avancement de la sortie de la grenade (1 → 0) et état du lancer, pour l'animation en main. */
  get pose(): { draw: number; pulled: boolean; throwing: number | null } {
    return {
      draw: this.state === 'drawing' ? this.timer / DRAW_TIME : 0,
      pulled: this.state === 'pulled',
      throwing: this.state === 'throwing' ? 1 - this.timer / THROW_TIME : null,
    };
  }

  refill(): void {
    Object.assign(this.counts, GRENADE_LOADOUT);
  }

  /** Plus aucune grenade (mort en mode manches). */
  empty(): void {
    for (const type of GRENADE_ORDER) this.counts[type] = 0;
    this.current = null;
  }

  /** Vrai si on peut encore acheter une grenade de ce type (limites de CS:GO). */
  canGive(type: GrenadeType): boolean {
    const total = GRENADE_ORDER.reduce((sum, t) => sum + this.counts[t], 0);
    return total < GRENADE_CARRY.total && this.counts[type] < GRENADE_CARRY.perType[type];
  }

  /**
   * Ajoute une grenade achetée, dans les limites de CS:GO : une par type (deux
   * flashs) et quatre en tout. Renvoie faux si la limite est atteinte.
   */
  give(type: GrenadeType): boolean {
    if (!this.canGive(type)) return false;
    this.counts[type]++;
    return true;
  }

  /** Retire toutes les grenades et leurs effets (nouvelle manche). */
  clear(): void {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const d of this.decoys) this.scene.remove(d.projectile.mesh);
    for (const e of [...this.smokes, ...this.fires, ...this.explosions, ...this.scorches]) this.scene.remove(e.group);
    this.scorches.length = 0;
    this.projectiles.length = this.decoys.length = this.smokes.length = this.fires.length = this.explosions.length = 0;
    this.current = null;
  }

  /** Touche 4 : passe à la grenade suivante disponible. Renvoie faux s'il n'y en a aucune. */
  cycle(): boolean {
    const start = this.current ? GRENADE_ORDER.indexOf(this.current) + 1 : 0;
    for (let i = 0; i < GRENADE_ORDER.length; i++) {
      const type = GRENADE_ORDER[(start + i) % GRENADE_ORDER.length];
      if (this.counts[type] > 0) {
        if (type !== this.current || this.state !== 'pulled') this.select(type);
        return true;
      }
    }
    return false;
  }

  unequip(): void {
    this.current = null;
  }

  /** Lancer de la grenade en main (appelé à chaque tick quand une grenade est sortie). */
  updateInput(dt: number, input: Input): void {
    if (!this.current) return;
    const left = input.isDown('attack') || input.consumePress('attack');
    const right = input.isDown('attack2') || input.consumePress('attack2');
    const mask = (left ? 1 : 0) | (right ? 2 : 0);
    this.timer = Math.max(0, this.timer - dt);

    switch (this.state) {
      case 'drawing':
        if (this.timer === 0) this.state = 'ready';
        break;
      case 'ready':
        if (mask) {
          this.state = 'pulled';
          this.timer = PIN_TIME;
          this.heldMask = mask;
          this.hooks.pulled(GRENADES[this.current]);
        }
        break;
      case 'pulled':
        // On lance au relâchement, avec la force des boutons tenus juste avant.
        if (mask) this.heldMask = mask;
        else if (this.timer === 0) this.throwGrenade(this.heldMask);
        break;
      case 'throwing':
        if (this.timer === 0) {
          // Comme dans CS : plus de grenade de ce type, on ressort son arme.
          if (this.counts[this.current] > 0) this.select(this.current);
          else {
            this.current = null;
            this.hooks.emptyHanded();
          }
        }
        break;
    }
  }

  /** Lance une grenade d'un bot (les bots n'ont pas d'inventaire ici : c'est leur code qui compte). */
  launch(type: GrenadeType, origin: THREE.Vector3, velocity: THREE.Vector3, throwerBox: THREE.Box3, owner: GrenadeOwner): void {
    const projectile = new Projectile(type, origin.clone(), velocity.clone(), throwerBox, owner);
    this.projectiles.push(projectile);
    this.scene.add(projectile.mesh);
  }

  /** Grenades en vol et effets au sol (à chaque tick). */
  update(dt: number): void {
    const colliders = this.hooks.colliders();
    for (const projectile of [...this.projectiles]) {
      projectile.update(dt, colliders, (impact) => {
        if (impact.speed > 1.5) this.hooks.bounce(projectile.position, impact.speed);
        if (projectile.type === 'molotov' && impact.floor) this.detonate(projectile);
      });
      if (this.projectiles.includes(projectile)) this.checkFuse(projectile);
    }

    for (const decoy of [...this.decoys]) this.updateDecoy(decoy, dt);
    for (const smoke of this.smokes) smoke.update(dt);
    for (const fire of this.fires) fire.update(dt);
    for (const explosion of this.explosions) explosion.update(dt);
    this.removeFinished(this.smokes);
    this.removeFinished(this.fires);
    this.removeFinished(this.explosions);
    for (const scorch of this.scorches) scorch.update(dt);
    this.removeFinished(this.scorches);
    this.updateLights();
  }

  /** Vrai si une fumée coupe la ligne de vue entre deux points. */
  blocksVision(a: THREE.Vector3, b: THREE.Vector3): boolean {
    return this.smokes.some((smoke) => smoke.blocks(a, b));
  }

  /** Centre du feu de molotov où se trouvent ces pieds, ou null. */
  fireAt(feet: THREE.Vector3): THREE.Vector3 | null {
    return this.fires.find((fire) => fire.burns(feet))?.center ?? null;
  }

  /** Vrai si des pieds à cet endroit sont dans un feu de molotov. */
  burning(feet: THREE.Vector3): boolean {
    return this.fires.some((fire) => fire.burns(feet));
  }

  /** Épaisseur de fumée au point donné (0 à 1), pour griser l'écran quand on est dedans. */
  smokeAt(point: THREE.Vector3): number {
    return this.smokes.reduce((density, smoke) => (smoke.contains(point) ? Math.max(density, smoke.density) : density), 0);
  }

  private select(type: GrenadeType): void {
    this.current = type;
    this.state = 'drawing';
    this.timer = DRAW_TIME;
  }

  private throwGrenade(mask: number): void {
    const type = this.current!;
    // Gauche : lancer fort. Droit : lancer en cloche. Les deux : entre les deux.
    const strength = mask === 3 ? 0.5 : mask === 2 ? 0 : 1;
    const speed = GRENADE_PHYSICS.throwSpeed * (strength * 0.7 + 0.3);

    // Comme dans CS:GO, le lancer part un peu au-dessus du regard (10° à l'horizontale).
    const pitchDeg = this.player.pitch / DEG;
    const throwPitch = (pitchDeg + (10 * (90 + pitchDeg)) / 90) * DEG;
    this.euler.set(Math.min(throwPitch, 89 * DEG), this.player.yaw, 0);
    this.forward.set(0, 0, -1).applyEuler(this.euler);

    this.player.eyePosition(this.eye);
    const origin = this.eye.clone().addScaledVector(this.forward, 0.35);
    origin.y -= 0.05;
    if (!this.hooks.lineOfSight(this.eye, origin)) origin.copy(this.eye);

    const velocity = this.forward.clone().multiplyScalar(speed).addScaledVector(this.player.velocity, GRENADE_PHYSICS.inheritVelocity);
    const projectile = new Projectile(type, origin, velocity, this.player.box);
    this.projectiles.push(projectile);
    this.scene.add(projectile.mesh);

    this.counts[type]--;
    this.state = 'throwing';
    this.timer = THROW_TIME;
    this.hooks.thrown(GRENADES[type]);
  }

  private checkFuse(projectile: Projectile): void {
    const { fuse } = projectile.def;
    if (projectile.age < fuse) return;
    switch (projectile.type) {
      case 'he':
      case 'flash':
      case 'molotov':
        this.detonate(projectile);
        break;
      case 'smoke':
      case 'decoy':
        // Fumigène et leurre attendent d'être immobiles.
        if (projectile.resting) this.detonate(projectile);
        break;
    }
  }

  private detonate(projectile: Projectile): void {
    this.projectiles.splice(this.projectiles.indexOf(projectile), 1);
    const position = projectile.position.clone();
    const keepMesh = projectile.type === 'decoy';
    if (!keepMesh) this.scene.remove(projectile.mesh);

    switch (projectile.type) {
      case 'he':
        this.addEffect(this.explosions, new Explosion(position));
        // Trace noire au sol si l'explosion a lieu près du sol.
        const floorY = this.hooks.floorBelow(position.clone().setY(position.y + 0.1));
        if (position.y - floorY < 1.5) this.addEffect(this.scorches, new Scorch(position.clone().setY(floorY), 3.4, 25));
        this.hooks.explode(position, projectile.owner);
        break;
      case 'flash':
        this.addEffect(this.explosions, new Explosion(position, 'flash'));
        this.hooks.flashbang(position, projectile.owner);
        break;
      case 'smoke': {
        const floor = position.clone().setY(position.y - GRENADE_PHYSICS.radius);
        this.addEffect(this.smokes, new SmokeCloud(floor));
        // La fumée éteint les molotovs qu'elle recouvre.
        for (const fire of this.fires) {
          if (fire.center.distanceTo(floor) < SMOKE.radius + MOLOTOV.radius * 0.5) fire.extinguished = true;
        }
        this.hooks.smoke(position);
        break;
      }
      case 'molotov': {
        const floor = position.clone().setY(projectile.resting || position.y - this.hooks.floorBelow(position) < 0.2
          ? position.y - GRENADE_PHYSICS.radius
          : this.hooks.floorBelow(position));
        // Un molotov qui tombe dans une fumée s'éteint aussitôt.
        const fizzled = this.smokes.some((smoke) => smoke.contains(floor.clone().setY(floor.y + 0.9)));
        if (!fizzled) {
          this.addEffect(this.fires, new FireArea(floor));
          this.addEffect(this.scorches, new Scorch(floor, MOLOTOV.radius * 2.3, MOLOTOV.duration + 12));
        }
        this.hooks.fire(floor, fizzled);
        break;
      }
      case 'decoy':
        this.decoys.push({ projectile, time: 0, burstLeft: 0, nextShot: 0.3 });
        break;
    }
  }

  /** Le leurre imite des rafales de fusil pendant 15 s, puis éclate. */
  private updateDecoy(decoy: Decoy, dt: number): void {
    decoy.time += dt;
    decoy.nextShot -= dt;
    if (decoy.time >= DECOY.duration) {
      this.decoys.splice(this.decoys.indexOf(decoy), 1);
      this.scene.remove(decoy.projectile.mesh);
      this.hooks.decoyEnded(decoy.projectile.position);
      return;
    }
    if (decoy.nextShot > 0) return;
    if (decoy.burstLeft === 0) decoy.burstLeft = 1 + Math.floor(Math.random() * 5);
    this.hooks.decoyShot(decoy.projectile.position);
    decoy.burstLeft--;
    decoy.nextShot = decoy.burstLeft > 0 ? 0.1 : 0.6 + Math.random() * 1.4;
  }

  private addEffect<T extends { group: THREE.Group }>(list: T[], effect: T): void {
    list.push(effect);
    this.scene.add(effect.group);
  }

  private removeFinished<T extends { group: THREE.Group; finished: boolean }>(list: T[]): void {
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i].finished) continue;
      this.scene.remove(list[i].group);
      list.splice(i, 1);
    }
  }

  /** Une lumière pour l'explosion la plus récente, une autre pour le feu le plus fort. */
  private updateLights(): void {
    const explosion = this.explosions[this.explosions.length - 1];
    this.flashLight.intensity = explosion ? explosion.glow : 0;
    if (explosion) this.flashLight.position.copy(explosion.group.position).setY(explosion.group.position.y + 1);

    const fire = this.fires.reduce<FireArea | null>((best, f) => (!best || f.glow > best.glow ? f : best), null);
    this.fireLight.intensity = fire ? fire.glow : 0;
    if (fire) this.fireLight.position.copy(fire.center).setY(fire.center.y + 0.8);
  }
}
