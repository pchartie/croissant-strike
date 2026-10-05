import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BOTS, DIFFICULTY, PLAYER } from '../config';
import { absorbDamage, type DamageZone } from '../core/armor';
import { flashDuration } from '../grenades/flashbang';
import type { Player } from '../player/Player';
import { RIFLE } from '../weapons/definitions';
import type { NavGrid } from '../world/NavGrid';
import type { World } from '../world/World';
import { Bot, type BotContext, type Target, type Team } from './Bot';
import { DAMAGE_MULTIPLIER, type HitPart } from './BotModel';

const NAMES: Record<Team, string[]> = {
  enemy: ['Gaston', 'Marcel', 'Lucien', 'Raymond', 'Didier', 'Hubert', 'Roger', 'Firmin', 'Edmond', 'Fernand'],
  ally: ['Margot', 'Inès', 'Chloé', 'Lucas'],
};
/** Distance minimale entre le joueur et un bot ennemi qui réapparaît. */
const MIN_SPAWN_DISTANCE = 25;
/** Zones d'apparition en mode manches : les ennemis au nord, l'équipe du joueur au sud. */
const ROUND_SPAWN_Z = { enemy: -26, ally: 24 };
/** Distance maximale entre le joueur et ses coéquipiers au début d'une manche. */
const ALLY_SPAWN_RADIUS = 9;

export interface BotShot {
  bot: Bot;
  origin: THREE.Vector3;
  /** Point d'arrivée de la balle (pour la traînée). */
  end: THREE.Vector3;
  /** Mur ou objet touché, si la balle n'a touché personne. */
  worldHit: THREE.Intersection | null;
  /** Dégâts bruts infligés au joueur (avant son gilet), ou 0 s'il n'est pas touché. */
  playerDamage: number;
  /** Bot de l'autre camp touché, s'il y en a un. */
  victim: Bot | null;
  /** Vrai si la balle a tué `victim`. */
  killed: boolean;
  part: HitPart | null;
  headshot: boolean;
}

export interface BotEvents {
  shot(shot: BotShot): void;
  /** Un bot lance une grenade vers `target`. */
  grenade(bot: Bot, type: 'he' | 'flash', target: THREE.Vector3): void;
}

/** Fait apparaître, vivre, tirer et réapparaître les bots des deux camps. */
export class BotManager {
  readonly bots: Bot[] = [];
  private readonly context: BotContext;
  private enabled = true;
  private aggressive = true;
  private gunTemplate: THREE.Object3D | null = null;
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
      targets: (bot) => this.targetsOf(bot),
      colliders: (bot) => this.collidersFor(bot),
      lineOfSight: (from, to) => this.lineOfSight(from, to) && !this.visionBlocker(from, to),
      shoot: (bot, origin, direction) => this.shoot(bot, origin, direction),
      throwGrenade: (bot, type, target) => this.events.grenade(bot, type, target),
    };

    this.setCount(BOTS.count);
  }

  get enemies(): Bot[] {
    return this.bots.filter((bot) => bot.team === 'enemy');
  }

  get allies(): Bot[] {
    return this.bots.filter((bot) => bot.team === 'ally');
  }

  /** Donne à chaque bot une copie de ce modèle d'arme. */
  setWeaponModel(template: THREE.Object3D): void {
    this.gunTemplate = template;
    for (const bot of this.bots) bot.model.setGun(cloneSkinned(template));
  }

  /**
   * Nombre de bots ennemis. Les nouveaux apparaissent loin du joueur, ou
   * attendent la manche suivante en mode manches.
   */
  setCount(count: number): void {
    this.resize('enemy', count);
  }

  /** Nombre de coéquipiers du joueur. */
  setAllies(count: number): void {
    this.resize('ally', count);
  }

  private resize(team: Team, count: number): void {
    const members = this.bots.filter((bot) => bot.team === team);
    for (let i = members.length; i < count; i++) {
      const bot = new Bot(NAMES[team][i % NAMES[team].length], team);
      if (this.gunTemplate) bot.model.setGun(cloneSkinned(this.gunTemplate));
      bot.setAggressive(this.aggressive);
      this.scene.add(bot.model.root);
      this.bots.push(bot);
      if (this.enabled && this.respawnEnabled) bot.spawn(this.spawnPoint(team));
      else bot.disable();
    }
    for (const bot of members.slice(count)) {
      this.scene.remove(bot.model.root);
      this.bots.splice(this.bots.indexOf(bot), 1);
    }
  }

  /** Change le temps de réaction, la précision et la vitesse de visée des bots. */
  setDifficulty(difficulty: keyof typeof DIFFICULTY): void {
    Object.assign(BOTS, DIFFICULTY[difficulty]);
  }

  /** Zones touchables des bots ennemis vivants (les balles du joueur traversent ses coéquipiers). */
  get hitboxes(): THREE.Mesh[] {
    return this.enemies.filter((bot) => bot.alive).flatMap((bot) => bot.model.hitboxes);
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
      if (enabled) bot.spawn(this.spawnPoint(bot.team));
      else bot.disable();
    }
  }

  /** Agressifs : ils se battent. Passifs : ils se promènent et servent de cibles. */
  setAggressive(aggressive: boolean): void {
    this.aggressive = aggressive;
    for (const bot of this.bots) bot.setAggressive(aggressive);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    for (const bot of this.bots) {
      bot.update(dt, this.context);
      if (this.respawnEnabled && !bot.alive && bot.deadTime > BOTS.respawnDelay) bot.spawn(this.spawnPoint(bot.team));
    }
  }

  render(alpha: number): void {
    for (const bot of this.bots) bot.render(alpha);
  }

  /** Remet à zéro les statistiques des bots (nouveau match, changement de mode). */
  resetStats(): void {
    for (const bot of this.bots) bot.kills = bot.deaths = 0;
  }

  /** Les ennemis proches entendent les pas du joueur (quand il court) et viennent voir. */
  heardStep(position: THREE.Vector3): void {
    for (const bot of this.enemies) {
      if (bot.body.position.distanceTo(position) < BOTS.footstepRange) bot.investigate(position);
    }
  }

  /** Les ennemis proches entendent le joueur tirer. */
  playerFired(position: THREE.Vector3): void {
    this.heardShot(position, 'ally');
  }

  /** Ennemis encore en vie. */
  get aliveCount(): number {
    return this.enemies.filter((bot) => bot.alive).length;
  }

  get alliesAlive(): number {
    return this.allies.filter((bot) => bot.alive).length;
  }

  setVisionBlocker(blocker: (from: THREE.Vector3, to: THREE.Vector3) => boolean): void {
    this.visionBlocker = blocker;
  }

  /** Début de manche : les ennemis au nord face au sud, les coéquipiers au sud avec le joueur. */
  resetForRound(): void {
    const taken: THREE.Vector3[] = [];
    for (const bot of this.bots) {
      if (!this.enabled) {
        bot.disable();
        continue;
      }
      // Les coéquipiers apparaissent groupés autour du joueur.
      const inZone = (point: THREE.Vector3) =>
        bot.team === 'enemy' ? point.z < ROUND_SPAWN_Z.enemy : point.z > ROUND_SPAWN_Z.ally && point.distanceTo(this.player.position) < ALLY_SPAWN_RADIUS;
      let point = this.nav.randomWalkablePoint();
      for (let i = 0; i < 400; i++) {
        const candidate = this.nav.randomWalkablePoint();
        // Loin du point d'apparition du joueur aussi, pour ne pas apparaître dans lui.
        const clear = taken.every((other) => other.distanceTo(candidate) > 2) && candidate.distanceTo(this.player.position) > 2;
        if (inZone(candidate) && clear) {
          point = candidate;
          break;
        }
      }
      taken.push(point);
      bot.spawn(point, bot.team === 'enemy' ? Math.PI : 0);
    }
  }

  /** Dégâts directs (grenade, feu) ; renvoie vrai si le bot en meurt. */
  damageBot(bot: Bot, amount: number, zone: DamageZone = 'fire', armorRatio = 1, from: THREE.Vector3 = this.player.position): boolean {
    return bot.damage(absorbDamage(bot, amount, zone, armorRatio), from);
  }

  /** Flash : chaque bot qui la voit est aveuglé selon l'angle et la distance. */
  flash(position: THREE.Vector3, thrower: unknown = null): void {
    for (const bot of this.bots) {
      // Le lanceur se détourne de sa propre flash.
      if (!bot.alive || bot === thrower) continue;
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
  hit(mesh: THREE.Object3D, baseDamage: number, armorRatio: number): { bot: Bot; part: HitPart; killed: boolean } {
    const bot = mesh.userData.bot as Bot;
    const part = mesh.userData.part as HitPart;
    const health = absorbDamage(bot, baseDamage * DAMAGE_MULTIPLIER[part], part, armorRatio);
    const killed = bot.damage(health, this.player.position);
    return { bot, part, killed };
  }

  /** Les adversaires d'un bot : le joueur et ses coéquipiers pour un ennemi, les ennemis pour un coéquipier. */
  private targetsOf(bot: Bot): Target[] {
    const opponents: Target[] = this.bots.filter((other) => other.team !== bot.team);
    if (bot.team === 'enemy') opponents.push(this.player);
    return opponents;
  }

  /** Les bots du camp `shooterTeam` tirent : leurs adversaires proches l'entendent et viennent voir. */
  private heardShot(position: THREE.Vector3, shooterTeam: Team): void {
    for (const bot of this.bots) {
      if (bot.team !== shooterTeam && bot.body.position.distanceTo(position) < BOTS.hearingRange) bot.investigate(position);
    }
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

  /**
   * Une balle de bot : elle s'arrête sur le premier mur, joueur ou bot adverse
   * touché (elle traverse les coéquipiers du tireur).
   */
  private shoot(bot: Bot, origin: THREE.Vector3, direction: THREE.Vector3): void {
    this.heardShot(origin, bot.team);
    this.raycaster.set(origin, direction);
    this.raycaster.far = RIFLE.range;
    const worldHit = this.raycaster.intersectObjects(this.world.meshes, false)[0] ?? null;
    let nearest = worldHit ? worldHit.distance : RIFLE.range;

    const opponents = this.bots.filter((other) => other.team !== bot.team && other.alive);
    const botHit = this.raycaster.intersectObjects(opponents.flatMap((other) => other.model.hitboxes), false)[0] ?? null;
    if (botHit && botHit.distance < nearest) nearest = botHit.distance;

    this.ray.set(origin, direction);
    const hitPlayer = bot.team === 'enemy' && this.player.alive && this.ray.intersectBox(this.player.box, this.playerHit);
    const muzzle = bot.model.muzzle.getWorldPosition(new THREE.Vector3());
    const base = { bot, origin: muzzle, worldHit: null, playerDamage: 0, victim: null, killed: false };

    if (hitPlayer && origin.distanceTo(this.playerHit) < nearest) {
      const height = this.playerHit.y - this.player.position.y;
      // Tête : les 32 cm du haut, debout comme accroupi. Jambes : sous 80 cm (debout seulement).
      const top = this.player.height;
      const part: HitPart = height > top - 0.32 ? 'head' : height < 0.8 && !this.player.crouched ? 'legs' : 'body';
      this.events.shot({
        ...base,
        end: this.playerHit.clone(),
        playerDamage: Math.round(RIFLE.damage * DAMAGE_MULTIPLIER[part]),
        part,
        headshot: part === 'head',
      });
      return;
    }

    if (botHit && botHit.distance === nearest) {
      const victim = botHit.object.userData.bot as Bot;
      const part = botHit.object.userData.part as HitPart;
      const health = absorbDamage(victim, RIFLE.damage * DAMAGE_MULTIPLIER[part], part, RIFLE.armorRatio);
      const killed = victim.damage(health, bot.body.position);
      if (killed) bot.kills++;
      this.events.shot({ ...base, end: botHit.point.clone(), victim, killed, part, headshot: part === 'head' });
      return;
    }

    const end = origin.clone().addScaledVector(direction, nearest);
    this.events.shot({ ...base, end, worldHit, part: null, headshot: false });
  }

  /** Point de réapparition du joueur : hors de vue des ennemis et le plus loin possible d'eux. */
  playerSpawnPoint(): THREE.Vector3 {
    const alive = this.enemies.filter((bot) => bot.alive);
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

  /** Un point libre ; pour un ennemi, loin du joueur (choisi parmi les plus éloignés). */
  private spawnPoint(team: Team): THREE.Vector3 {
    // Jamais sur un autre bot : deux corps superposés, la collision en pose un sur la tête de l'autre.
    const free = (point: THREE.Vector3) =>
      this.bots.every((bot) => !bot.alive || bot.body.position.distanceTo(point) > 2) && point.distanceTo(this.player.position) > 2;
    let best: THREE.Vector3 | null = null;
    for (let i = 0; i < 40; i++) {
      const candidate = this.nav.randomWalkablePoint();
      if (!free(candidate)) continue;
      if (team === 'ally') return candidate;
      const distance = candidate.distanceTo(this.player.position);
      if (distance > MIN_SPAWN_DISTANCE) return candidate;
      if (!best || distance > best.distanceTo(this.player.position)) best = candidate;
    }
    return best ?? this.nav.randomWalkablePoint();
  }
}
