import * as THREE from 'three';
import { BOTS, MOVE, PLAYER } from '../config';
import { RIFLE } from '../weapons/definitions';
import { Body } from '../world/Body';
import type { NavGrid } from '../world/NavGrid';
import { BotModel } from './BotModel';

const DEG = Math.PI / 180;
const THINK_INTERVAL = 0.1;
const WALK_SPEED = MOVE.maxSpeed * 0.85;
const STRAFE_SPEED = MOVE.maxSpeed * 0.75;
const WAYPOINT_REACHED = 0.35;
/** Temps sans voir le joueur avant d'aller le chercher là où il a été vu. */
const LOSE_SIGHT_DELAY = 0.6;
const SEARCH_LOOK_TIME = 2;
const FALL_DURATION = 0.35;
/** Temps passé à s'écarter tout droit d'un feu. */
const ESCAPE_TIME = 0.6;
/** Grenades : pas avant ce délai après l'apparition, puis au plus une toutes les 8 à 14 s. */
const GRENADE_FIRST_DELAY = 6;
/** Distance du joueur (sa dernière position connue) entre laquelle un bot lance une grenade. */
const GRENADE_RANGE = { min: 6, max: 28 };
/** Chance de sauter à chaque changement de sens d'un pas de côté en combat. */
const STRAFE_JUMP_CHANCE = 0.15;
/** Hauteur visée sur le joueur selon sa taille (debout ou accroupi). */
const chestHeight = (height: number) => height * 0.68;
const headHeight = (height: number) => height - 0.15;

type State = 'patrol' | 'combat' | 'search' | 'dead';

/** Les bots ennemis (les « terroristes ») et les coéquipiers du joueur. */
export type Team = 'enemy' | 'ally';

/** Quelqu'un sur qui un bot peut tirer : le joueur ou un bot de l'autre camp. */
export interface Target {
  readonly position: THREE.Vector3;
  readonly height: number;
  readonly alive: boolean;
}

/** Ce dont un bot a besoin pour percevoir le monde et agir dessus. */
export interface BotContext {
  readonly nav: NavGrid;
  /** Les adversaires de ce bot (vivants ou non). */
  targets(bot: Bot): readonly Target[];
  /** Obstacles contre lesquels ce bot se cogne. */
  colliders(bot: Bot): readonly THREE.Box3[];
  /** Vrai si rien ne bloque la ligne entre deux points. */
  lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean;
  shoot(bot: Bot, origin: THREE.Vector3, direction: THREE.Vector3): void;
  /** Lance une grenade vers `target`. */
  throwGrenade(bot: Bot, type: 'he' | 'flash', target: THREE.Vector3): void;
}

/**
 * Un bot, ennemi ou coéquipier. Il patrouille, attaque l'adversaire le plus
 * proche dès qu'il le voit (après un temps de réaction, avec une visée qui se
 * stabilise), tire en rafales en se déplaçant de côté entre deux rafales, puis
 * va le chercher s'il le perd de vue.
 */
export class Bot implements Target {
  readonly body = new Body(PLAYER.radius, PLAYER.height);
  readonly model: BotModel;
  health: number = BOTS.health;
  /** Les bots portent gilet et casque, comme les bots de CS quand ils ont de l'argent. */
  armor = 100;
  helmet = true;
  /** En mode passif, le bot patrouille sans jamais attaquer ni chercher le joueur. */
  private aggressive = true;
  /** Statistiques pour le tableau des scores. */
  kills = 0;
  deaths = 0;
  /** Temps écoulé depuis la mort. */
  deadTime = 0;

  private state: State = 'patrol';
  private yaw = 0;
  private pitch = 0;

  private path: THREE.Vector3[] = [];
  private pathIndex = 0;
  private thinkTimer = Math.random() * THINK_INTERVAL;
  private stuckTimer = 0;
  private readonly stuckCheck = new THREE.Vector3();
  private searchTimer = 0;

  private seesFoe = false;
  /** L'adversaire combattu (le plus proche de ceux qu'il voit). */
  private foe: Target | null = null;
  private lostTimer = 0;
  private readonly lastKnown = new THREE.Vector3();
  /** Taille de la cible quand elle a été vue (plus petite accroupie). */
  private targetHeight = PLAYER.height;
  private spottedTime = 0;
  private reactionTimer = 0;
  private aimAtHead = false;
  /** Temps d'aveuglement restant après une flash. */
  private blindTimer = 0;
  /** Évite de recalculer un chemin de fuite à chaque tick passé dans le feu. */
  private fleeCooldown = 0;
  private escapeTimer = 0;
  private readonly escapeDir = new THREE.Vector3();
  private readonly aimError = { yaw: 0, pitch: 0, timer: 0 };

  private ammo = RIFLE.magazine;
  /** Une HE et une flash par vie, lancées quand il perd le joueur de vue. */
  private grenades = { he: 1, flash: 1 };
  private grenadeCooldown = GRENADE_FIRST_DELAY;
  private reloadTimer = 0;
  private fireCooldown = 0;
  private burstLeft = 0;
  private burstPause = 0;
  private shotsInBurst = 0;
  private strafeDir = 1;
  private strafeTimer = 0;

  private readonly desired = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly shotDir = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly aim = new THREE.Quaternion();

  constructor(
    readonly name: string,
    readonly team: Team = 'enemy',
  ) {
    this.model = new BotModel(team);
    for (const hitbox of this.model.hitboxes) hitbox.userData.bot = this;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get position(): THREE.Vector3 {
    return this.body.position;
  }

  get height(): number {
    return this.body.height;
  }

  spawn(position: THREE.Vector3, yaw = Math.random() * Math.PI * 2): void {
    this.body.teleport(position);
    this.health = BOTS.health;
    this.armor = 100;
    this.helmet = true;
    this.deadTime = 0;
    this.state = 'patrol';
    this.path = [];
    this.ammo = RIFLE.magazine;
    this.grenades = { he: 1, flash: 1 };
    this.grenadeCooldown = GRENADE_FIRST_DELAY * (0.5 + Math.random());
    this.reloadTimer = 0;
    this.burstLeft = 0;
    this.seesFoe = false;
    this.foe = null;
    this.yaw = yaw;
    this.blindTimer = 0;
    this.pitch = 0;
    this.model.root.rotation.set(0, this.yaw, 0);
    this.model.root.visible = true;
    this.stuckCheck.copy(position);
  }

  /** En passant en passif, le bot arrête tout de suite de combattre ou de chercher le joueur. */
  setAggressive(aggressive: boolean): void {
    this.aggressive = aggressive;
    if (aggressive || !this.alive) return;
    this.state = 'patrol';
    this.seesFoe = false;
    this.foe = null;
    this.burstLeft = 0;
    this.path = [];
  }

  /** Retire le bot du jeu (invisible, intouchable) jusqu'au prochain `spawn`. */
  disable(): void {
    this.state = 'dead';
    this.deadTime = 0;
    this.model.root.visible = false;
  }

  /** Inflige des dégâts ; renvoie vrai si le bot en meurt. */
  damage(amount: number, attackerPosition: THREE.Vector3): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.deaths++;
      this.state = 'dead';
      this.deadTime = 0;
      return true;
    }
    // Touché sans voir le tireur : il se retourne et va voir.
    if (this.state !== 'combat') this.investigate(attackerPosition);
    return false;
  }

  /** Le bot a entendu ou senti quelque chose à cet endroit. */
  investigate(position: THREE.Vector3): void {
    if (!this.alive || !this.aggressive || this.state === 'combat') return;
    this.lastKnown.copy(position);
    this.state = 'search';
    this.searchTimer = 0;
    this.path = [];
  }

  update(dt: number, ctx: BotContext): void {
    if (!this.alive) {
      this.deadTime += dt;
      this.model.fall(Math.min(this.deadTime / FALL_DURATION, 1));
      this.model.root.updateMatrixWorld();
      return;
    }

    this.blindTimer = Math.max(0, this.blindTimer - dt);
    this.fleeCooldown = Math.max(0, this.fleeCooldown - dt);
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer += THINK_INTERVAL;
      this.think(ctx);
    }

    this.desired.set(0, 0, 0);
    if (this.state === 'combat') this.fight(dt, ctx);
    else this.followPath();

    if (this.escapeTimer > 0) {
      this.escapeTimer -= dt;
      this.desired.copy(this.escapeDir).multiplyScalar(WALK_SPEED);
    }

    // Accélération simple vers la vitesse voulue, puis gravité et collisions.
    const blend = Math.min(1, dt * 10);
    this.body.velocity.x += (this.desired.x - this.body.velocity.x) * blend;
    this.body.velocity.z += (this.desired.z - this.body.velocity.z) * blend;
    this.body.velocity.y -= MOVE.gravity * dt;
    this.body.move(dt, ctx.colliders(this));

    this.turn(dt);
    this.model.pose(this.body.position, this.yaw, this.pitch, this.body.horizontalSpeed / MOVE.maxSpeed, dt);
    this.model.root.updateMatrixWorld();
  }

  /** Position affichée entre deux ticks, pour un mouvement fluide. */
  render(alpha: number): void {
    if (this.alive) this.model.root.position.lerpVectors(this.body.previousPosition, this.body.position, alpha);
  }

  /** Aveuglé par une flash : il ne voit plus et ne tire plus pendant ce temps. */
  blind(seconds: number): void {
    this.blindTimer = Math.max(this.blindTimer, seconds);
  }

  /** Direction du regard. */
  forward(target: THREE.Vector3): THREE.Vector3 {
    this.euler.set(this.pitch, this.yaw, 0);
    return target.set(0, 0, -1).applyEuler(this.euler);
  }

  /**
   * Dans le feu : il s'en écarte tout droit, même en plein combat, puis (hors
   * combat) part patrouiller ailleurs.
   */
  escapeFire(center: THREE.Vector3, ctx: BotContext): void {
    this.escapeDir.set(this.body.position.x - center.x, 0, this.body.position.z - center.z);
    if (this.escapeDir.lengthSq() < 1e-4) this.escapeDir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    this.escapeDir.normalize();
    this.escapeTimer = ESCAPE_TIME;
    if (this.fleeCooldown > 0 || this.state === 'combat' || !this.alive) return;
    this.fleeCooldown = 1;
    this.state = 'patrol';
    this.setPath(ctx, ctx.nav.randomWalkablePoint());
  }

  eyePosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.body.position).setY(this.body.position.y + PLAYER.eyeHeight);
  }

  // --- Perception et décisions (10 fois par seconde) ---

  private think(ctx: BotContext): void {
    const targets = ctx.targets(this);
    const foe = this.aggressive ? this.pickFoe(targets, ctx) : null;
    const sees = foe !== null;
    if (foe) {
      if (this.state !== 'combat') this.engage();
      this.foe = foe;
      this.lastKnown.copy(foe.position);
      this.targetHeight = foe.height;
      this.lostTimer = 0;
    } else if (this.state === 'combat') {
      this.lostTimer += THINK_INTERVAL;
      // Cible abattue : plus la peine d'aller voir là où elle était.
      const foeDown = this.foe !== null && !this.foe.alive;
      if (this.lostTimer > LOSE_SIGHT_DELAY || foeDown) {
        this.state = !foeDown && this.aggressive ? 'search' : 'patrol';
        this.foe = null;
        this.searchTimer = 0;
        this.path = [];
      }
    }
    this.seesFoe = sees;
    this.considerGrenade(ctx, targets);

    if (this.state === 'patrol' && this.pathDone) {
      this.setPath(ctx, ctx.nav.randomWalkablePoint());
    } else if (this.state === 'search') {
      if (this.path.length === 0) this.setPath(ctx, this.lastKnown);
      if (this.pathDone) {
        this.searchTimer += THINK_INTERVAL;
        // Regarde autour de lui avant de reprendre sa patrouille.
        this.yaw += 0.35;
        if (this.searchTimer > SEARCH_LOOK_TIME) {
          this.state = 'patrol';
          this.path = [];
        }
      }
    }

    // Bloqué (souvent par un autre bot qui vient en face) : on part ailleurs,
    // sinon les deux recalculent le même chemin et restent coincés.
    this.stuckTimer += THINK_INTERVAL;
    if (this.stuckTimer >= 1) {
      const moved = this.stuckCheck.distanceTo(this.body.position);
      if (moved < 0.3 && !this.pathDone && this.state !== 'combat') {
        // Un petit saut décoince souvent d'un rebord ou d'un coin.
        if (this.body.onGround) this.body.velocity.y = MOVE.jumpSpeed;
        this.state = 'patrol';
        this.setPath(ctx, ctx.nav.randomWalkablePoint());
      }
      this.stuckCheck.copy(this.body.position);
      this.stuckTimer = 0;
    }
  }

  /**
   * L'adversaire vient de disparaître (il se cache, ou le bot va le chercher) :
   * de temps en temps, une flash avant d'aller voir, ou une HE sur sa cachette.
   */
  private considerGrenade(ctx: BotContext, targets: readonly Target[]): void {
    this.grenadeCooldown -= THINK_INTERVAL;
    if (this.grenadeCooldown > 0 || this.seesFoe || !targets.some((target) => target.alive)) return;
    if (this.state !== 'search' && this.state !== 'combat') return;
    const distance = this.body.position.distanceTo(this.lastKnown);
    if (distance < GRENADE_RANGE.min || distance > GRENADE_RANGE.max) return;

    const type = this.state === 'search' && this.grenades.flash > 0 ? 'flash' : this.grenades.he > 0 ? 'he' : this.grenades.flash > 0 ? 'flash' : null;
    if (!type || Math.random() > 0.35) {
      this.grenadeCooldown = 1.5;
      return;
    }
    this.grenades[type]--;
    this.grenadeCooldown = 8 + Math.random() * 6;
    ctx.throwGrenade(this, type, this.lastKnown);
  }

  /** L'adversaire visible le plus proche ; en combat, il garde sa cible tant qu'il la voit. */
  private pickFoe(targets: readonly Target[], ctx: BotContext): Target | null {
    if (this.blindTimer > 0) return null;
    if (this.state === 'combat' && this.foe?.alive && this.canSee(this.foe, ctx)) return this.foe;
    let best: Target | null = null;
    let bestDistance = Infinity;
    for (const target of targets) {
      const distance = target.position.distanceTo(this.body.position);
      if (distance < bestDistance && this.canSee(target, ctx)) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  private canSee(target: Target, ctx: BotContext): boolean {
    if (!target.alive) return false;
    this.eyePosition(this.eye);
    const dx = target.position.x - this.body.position.x;
    const dz = target.position.z - this.body.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > BOTS.visionRange) return false;

    // En combat, il suit sa cible même si elle passe sur le côté.
    if (this.state !== 'combat') {
      const forwardX = -Math.sin(this.yaw);
      const forwardZ = -Math.cos(this.yaw);
      const cos = (dx * forwardX + dz * forwardZ) / Math.max(distance, 1e-6);
      if (cos < Math.cos((BOTS.visionAngle / 2) * DEG)) return false;
    }

    for (const height of [headHeight(target.height), chestHeight(target.height)]) {
      this.target.copy(target.position).setY(target.position.y + height);
      if (ctx.lineOfSight(this.eye, this.target)) return true;
    }
    return false;
  }

  private engage(): void {
    this.state = 'combat';
    this.spottedTime = 0;
    this.reactionTimer = BOTS.reactionTime * (0.8 + Math.random() * 0.4);
    this.aimAtHead = Math.random() < BOTS.headshotChance;
    this.aimError.timer = 0;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.path = [];
  }

  // --- Déplacements ---

  private get pathDone(): boolean {
    return this.pathIndex >= this.path.length;
  }

  private setPath(ctx: BotContext, destination: THREE.Vector3): void {
    this.path = ctx.nav.findPath(this.body.position, destination) ?? [];
    this.pathIndex = 0;
  }

  private followPath(): void {
    while (!this.pathDone) {
      const waypoint = this.path[this.pathIndex];
      const dx = waypoint.x - this.body.position.x;
      const dz = waypoint.z - this.body.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < WAYPOINT_REACHED) {
        this.pathIndex++;
        continue;
      }
      this.desired.set((dx / distance) * WALK_SPEED, 0, (dz / distance) * WALK_SPEED);
      return;
    }
  }

  // --- Combat ---

  private fight(dt: number, ctx: BotContext): void {
    this.spottedTime += dt;
    this.reactionTimer -= dt;
    this.fireCooldown -= dt;

    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.ammo = RIFLE.magazine;
    }

    // Erreur de visée : grande quand il vient de repérer le joueur, puis plus fine.
    this.aimError.timer -= dt;
    if (this.aimError.timer <= 0) {
      const settle = Math.min(this.spottedTime / BOTS.aimSettleTime, 1);
      const amount = THREE.MathUtils.lerp(BOTS.aimErrorStart, BOTS.aimErrorSettled, settle) * DEG;
      this.aimError.yaw = (Math.random() * 2 - 1) * amount;
      this.aimError.pitch = (Math.random() * 2 - 1) * amount;
      this.aimError.timer = 0.15 + Math.random() * 0.15;
    }

    const canShoot = this.seesFoe && this.blindTimer === 0 && this.reactionTimer <= 0 && this.reloadTimer <= 0;
    if (canShoot && this.burstLeft > 0) {
      // S'arrête pour tirer, comme un vrai joueur : on est précis à l'arrêt.
      if (this.fireCooldown <= 0 && this.body.horizontalSpeed < MOVE.maxSpeed * 0.35) this.fire(ctx);
      return;
    }

    this.burstPause -= dt;
    if (canShoot && this.burstPause <= 0) {
      this.burstLeft = 3 + Math.floor(Math.random() * 4);
      this.shotsInBurst = 0;
      return;
    }

    // Entre deux rafales : pas de côté, en changeant de sens de temps en temps.
    this.strafeTimer -= dt;
    const toX = this.lastKnown.x - this.body.position.x;
    const toZ = this.lastKnown.z - this.body.position.z;
    const length = Math.hypot(toX, toZ) || 1;
    const sideX = (-toZ / length) * this.strafeDir;
    const sideZ = (toX / length) * this.strafeDir;
    const blocked = !ctx.nav.canStepTo(this.body.position, this.body.position.x + sideX, this.body.position.z + sideZ);
    if (this.strafeTimer <= 0 || blocked) {
      this.strafeDir *= -1;
      // Comme les bots de CS, ils sautent parfois en se décalant.
      if (this.body.onGround && Math.random() < STRAFE_JUMP_CHANCE) this.body.velocity.y = MOVE.jumpSpeed;
      this.strafeTimer = 0.4 + Math.random() * 0.5;
    }
    this.desired.set(sideX * STRAFE_SPEED, 0, sideZ * STRAFE_SPEED);
  }

  private fire(ctx: BotContext): void {
    this.fireCooldown = RIFLE.fireInterval;
    this.burstLeft--;
    this.shotsInBurst++;
    this.ammo--;
    if (this.ammo <= 0) {
      this.reloadTimer = RIFLE.reloadTime;
      this.burstLeft = 0;
    }
    if (this.burstLeft === 0) this.burstPause = 0.3 + Math.random() * 0.4;

    // Même dispersion que l'AK du joueur.
    const { spread } = RIFLE;
    const moving = Math.min(this.body.horizontalSpeed / MOVE.maxSpeed, 1);
    const cone = spread.base + spread.moving * moving + spread.perShot * Math.min(this.shotsInBurst, spread.maxShots);
    const radius = Math.tan(cone * Math.random());
    const angle = Math.random() * Math.PI * 2;

    this.euler.set(this.pitch, this.yaw, 0);
    this.aim.setFromEuler(this.euler);
    this.shotDir.set(Math.cos(angle) * radius, Math.sin(angle) * radius, -1).normalize().applyQuaternion(this.aim);

    this.model.showFlash();
    ctx.shoot(this, this.eyePosition(this.eye), this.shotDir);
  }

  /** Tourne la tête vers le joueur en combat, sinon vers là où il marche. */
  private turn(dt: number): void {
    let targetYaw = this.yaw;
    let targetPitch = 0;

    if (this.state === 'combat') {
      const height = this.aimAtHead ? headHeight(this.targetHeight) : chestHeight(this.targetHeight);
      const dx = this.lastKnown.x - this.body.position.x;
      const dz = this.lastKnown.z - this.body.position.z;
      const dy = this.lastKnown.y + height - (this.body.position.y + PLAYER.eyeHeight);
      targetYaw = Math.atan2(-dx, -dz) + this.aimError.yaw;
      targetPitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.aimError.pitch;
    } else if (this.body.horizontalSpeed > 0.5) {
      targetYaw = Math.atan2(-this.body.velocity.x, -this.body.velocity.z);
    }

    const maxStep = BOTS.turnSpeed * DEG * dt;
    const yawDelta = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
    this.yaw += THREE.MathUtils.clamp(yawDelta, -maxStep, maxStep);
    this.pitch += THREE.MathUtils.clamp(targetPitch - this.pitch, -maxStep, maxStep);
  }
}
