import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BOTS, PLAYER } from '../config';
import { flashDuration } from '../grenades/flashbang';
import type { Player } from '../player/Player';
import { RIFLE } from '../weapons/definitions';
import type { NavGrid } from '../world/NavGrid';
import type { World } from '../world/World';
import { Bot, type BotContext } from './Bot';
import { DAMAGE_MULTIPLIER, type HitPart } from './BotModel';

const NAMES = ['Gaston', 'Marcel', 'Lucien', 'Raymond', 'Didier', 'Hubert', 'Roger', 'Firmin'];
/** Distance minimale entre le joueur et un bot qui réapparaît. */
const MIN_SPAWN_DISTANCE = 25;
/** Zone d'apparition des bots en mode manches : le nord de la carte. */
const ROUND_SPAWN_Z = -26;

export interface BotShot {
  bot: Bot;
  origin: THREE.Vector3;
  /** Point d'arrivée de la balle (pour la traînée). */
  end: THREE.Vector3;
  /** Mur ou objet touché, si la balle n'a pas touché le joueur. */
  worldHit: THREE.Intersection | null;
  /** Dégâts infligés au joueur, ou 0 s'il n'est pas touché. */
  playerDamage: number;
  headshot: boolean;
}

export interface BotEvents {
  shot(shot: BotShot): void;
}

/** Fait apparaître, vivre, tirer et réapparaître les bots. */
export class BotManager {
  readonly bots: Bot[] = [];
  private readonly context: BotContext;
  private enabled = true;
  /** Faux en mode manches : un bot mort attend la manche suivante. */
  respawnEnabled = true;
  /** Ce qui bloque la vue en plus des murs (les fumigènes). */
  private visionBlocker: (from: THREE.Vector3, to: THREE.Vector3) => boolean = () => false;
  private readonly flashEye = new THREE.Vector3();
  private readonly flashForward = new THREE.Vector3();

  private readonly raycaster = new THREE.Raycaster();
  private readonly ray = new THREE.Ray();
  private readonly playerHit = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly nav: NavGrid,
    private readonly player: Player,
    private readonly events: BotEvents,
  ) {
    this.context = {
      nav,
      player,
      colliders: (bot) => this.collidersFor(bot),
      lineOfSight: (from, to) => this.lineOfSight(from, to) && !this.visionBlocker(from, to),
      shoot: (bot, origin, direction) => this.shoot(bot, origin, direction),
    };

    for (let i = 0; i < BOTS.count; i++) {
      const bot = new Bot(NAMES[i % NAMES.length]);
      this.scene.add(bot.model.root);
      this.bots.push(bot);
      bot.spawn(this.spawnPoint());
    }
  }

  /** Donne à chaque bot une copie de ce modèle d'arme. */
  setWeaponModel(template: THREE.Object3D): void {
    for (const bot of this.bots) bot.model.setGun(cloneSkinned(template));
  }

  /** Zones touchables des bots vivants. */
  get hitboxes(): THREE.Mesh[] {
    return this.bots.filter((bot) => bot.alive).flatMap((bot) => bot.model.hitboxes);
  }

  /** Boîtes des bots vivants, pour que le joueur ne leur passe pas au travers. */
  get colliders(): THREE.Box3[] {
    return this.bots.filter((bot) => bot.alive).map((bot) => bot.body.box);
  }

  /** Fait apparaître les bots (loin du joueur) ou les retire tous du jeu. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    for (const bot of this.bots) {
      if (enabled) bot.spawn(this.spawnPoint());
      else bot.disable();
    }
  }

  /** Agressifs : ils attaquent le joueur. Passifs : ils se promènent et servent de cibles. */
  setAggressive(aggressive: boolean): void {
    for (const bot of this.bots) bot.setAggressive(aggressive);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    for (const bot of this.bots) {
      bot.update(dt, this.context);
      if (this.respawnEnabled && !bot.alive && bot.deadTime > BOTS.respawnDelay) bot.spawn(this.spawnPoint());
    }
  }

  render(alpha: number): void {
    for (const bot of this.bots) bot.render(alpha);
  }

  /** Les bots proches entendent le joueur tirer. */
  playerFired(position: THREE.Vector3): void {
    for (const bot of this.bots) {
      if (bot.body.position.distanceTo(position) < BOTS.hearingRange) bot.investigate(position);
    }
  }

  get aliveCount(): number {
    return this.bots.filter((bot) => bot.alive).length;
  }

  setVisionBlocker(blocker: (from: THREE.Vector3, to: THREE.Vector3) => boolean): void {
    this.visionBlocker = blocker;
  }

  /** Début de manche : tous les bots réapparaissent dans la zone nord, face au sud. */
  resetForRound(): void {
    const taken: THREE.Vector3[] = [];
    for (const bot of this.bots) {
      if (!this.enabled) {
        bot.disable();
        continue;
      }
      let point = this.nav.randomWalkablePoint();
      for (let i = 0; i < 200; i++) {
        const candidate = this.nav.randomWalkablePoint();
        if (candidate.z < ROUND_SPAWN_Z && taken.every((other) => other.distanceTo(candidate) > 2)) {
          point = candidate;
          break;
        }
      }
      taken.push(point);
      bot.spawn(point, Math.PI);
    }
  }

  /** Dégâts directs (grenade, feu) ; renvoie vrai si le bot en meurt. */
  damageBot(bot: Bot, amount: number): boolean {
    return bot.damage(amount, this.player.position);
  }

  /** Flash : chaque bot qui la voit est aveuglé selon l'angle et la distance. */
  flash(position: THREE.Vector3): void {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      bot.eyePosition(this.flashEye);
      const visible = this.context.lineOfSight(position, this.flashEye);
      bot.blind(flashDuration(position, this.flashEye, bot.forward(this.flashForward), visible));
    }
  }

  /** Feux de molotov : brûle les bots dedans et les fait partir. */
  burn(fireAt: (feet: THREE.Vector3) => THREE.Vector3 | null, onDamage: (bot: Bot) => void): void {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const fire = fireAt(bot.body.position);
      if (!fire) continue;
      onDamage(bot);
      bot.escapeFire(fire, this.context);
    }
  }

  /** Applique un tir du joueur sur une zone touchée ; renvoie les dégâts et si le bot est mort. */
  hit(mesh: THREE.Object3D, baseDamage: number): { bot: Bot; part: HitPart; killed: boolean } {
    const bot = mesh.userData.bot as Bot;
    const part = mesh.userData.part as HitPart;
    const killed = bot.damage(baseDamage * DAMAGE_MULTIPLIER[part], this.player.position);
    return { bot, part, killed };
  }

  private collidersFor(bot: Bot): THREE.Box3[] {
    const colliders = [...this.world.colliders];
    if (this.player.alive) colliders.push(this.player.box);
    for (const other of this.bots) {
      if (other !== bot && other.alive) colliders.push(other.body.box);
    }
    return colliders;
  }

  private lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    this.direction.subVectors(to, from);
    const distance = this.direction.length();
    this.raycaster.set(from, this.direction.normalize());
    this.raycaster.far = distance;
    return this.raycaster.intersectObjects(this.world.meshes, false).length === 0;
  }

  private shoot(bot: Bot, origin: THREE.Vector3, direction: THREE.Vector3): void {
    this.raycaster.set(origin, direction);
    this.raycaster.far = RIFLE.range;
    const worldHit = this.raycaster.intersectObjects(this.world.meshes, false)[0] ?? null;

    const muzzle = bot.model.muzzle.getWorldPosition(new THREE.Vector3());

    this.ray.set(origin, direction);
    const hitPlayer = this.player.alive && this.ray.intersectBox(this.player.box, this.playerHit);
    if (hitPlayer && (!worldHit || origin.distanceTo(this.playerHit) < worldHit.distance)) {
      const height = this.playerHit.y - this.player.position.y;
      // Tête : les 32 cm du haut, debout comme accroupi. Jambes : sous 80 cm (debout seulement).
      const top = this.player.height;
      const part: HitPart = height > top - 0.32 ? 'head' : height < 0.8 && !this.player.crouched ? 'legs' : 'body';
      this.events.shot({
        bot,
        origin: muzzle,
        end: this.playerHit.clone(),
        worldHit: null,
        playerDamage: Math.round(RIFLE.damage * DAMAGE_MULTIPLIER[part]),
        headshot: part === 'head',
      });
      return;
    }

    const end = origin.clone().addScaledVector(direction, worldHit ? worldHit.distance : RIFLE.range);
    this.events.shot({ bot, origin: muzzle, end, worldHit, playerDamage: 0, headshot: false });
  }

  /** Point de réapparition du joueur : hors de vue des bots et le plus loin possible d'eux. */
  playerSpawnPoint(): THREE.Vector3 {
    const alive = this.bots.filter((bot) => bot.alive);
    const eye = new THREE.Vector3();
    const target = new THREE.Vector3();
    let best = this.nav.randomWalkablePoint();
    let bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const candidate = this.nav.randomWalkablePoint();
      target.copy(candidate).setY(candidate.y + PLAYER.eyeHeight);
      let nearest = Infinity;
      let seen = false;
      for (const bot of alive) {
        nearest = Math.min(nearest, bot.body.position.distanceTo(candidate));
        if (!seen) seen = this.lineOfSight(bot.eyePosition(eye), target);
      }
      const score = nearest - (seen ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  /** Un point libre loin du joueur, choisi au hasard parmi les plus éloignés. */
  private spawnPoint(): THREE.Vector3 {
    let best = this.nav.randomWalkablePoint();
    for (let i = 0; i < 20; i++) {
      const candidate = this.nav.randomWalkablePoint();
      const distance = candidate.distanceTo(this.player.position);
      const free = this.bots.every((bot) => !bot.alive || bot.body.position.distanceTo(candidate) > 2);
      if (free && distance > MIN_SPAWN_DISTANCE) return candidate;
      if (distance > best.distanceTo(this.player.position)) best = candidate;
    }
    return best;
  }
}
