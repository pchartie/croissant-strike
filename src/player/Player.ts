import * as THREE from 'three';
import { CAMERA, MOVE, PLAYER, UNIT } from '../config';
import type { Input } from '../core/Input';
import { Body } from '../world/Body';

const MAX_PITCH = THREE.MathUtils.degToRad(89);
/** sv_maxvelocity de CS: Source. */
const MAX_VELOCITY = 3500 * UNIT;
/** En dessous de cette hauteur, le joueur est tombé hors de la carte. */
const KILL_Y = -20;
const MAX_HEALTH = 100;
/** Vitesse à laquelle la caméra rattrape une marche montée (par seconde). */
const STEP_SMOOTHING = 12;

/**
 * Joueur avec les déplacements de Counter-Strike: Source : frottement au sol,
 * accélération limitée, contrôle en l'air (air strafe) et saut à l'appui.
 */
export class Player extends Body {
  yaw = 0;
  pitch = 0;
  health = MAX_HEALTH;
  /** Gilet pare-balles (0 à 100) et casque. */
  armor = 0;
  helmet = false;
  /** Radians par point de souris (réglage « Sensibilité »). */
  sensitivity = CAMERA.sensitivity;
  invertY = true;
  /** Boîte de collision en position accroupie. */
  crouched = false;
  /** Avancement de l'accroupissement pour la caméra : 0 debout, 1 accroupi. */
  private duckAmount = 0;

  private readonly wishDir = new THREE.Vector3();

  constructor() {
    super(PLAYER.radius, PLAYER.height);
  }

  get alive(): boolean {
    return this.health > 0;
  }

  /** Vrai si le joueur est tombé hors de la carte (filet de sécurité). */
  get outOfMap(): boolean {
    return this.position.y < KILL_Y;
  }

  spawn(position: THREE.Vector3, yaw: number): void {
    this.teleport(position);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = MAX_HEALTH;
    this.crouched = false;
    this.duckAmount = 0;
    this.height = PLAYER.height;
  }

  /** Hauteur des yeux au-dessus des pieds, qui descend quand on s'accroupit. */
  get eyeHeight(): number {
    return THREE.MathUtils.lerp(PLAYER.eyeHeight, PLAYER.duckEyeHeight, this.duckAmount);
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * this.sensitivity;
    // Inversé : pousser la souris vers l'avant fait regarder en bas.
    const vertical = this.invertY ? dy : -dy;
    this.pitch = THREE.MathUtils.clamp(this.pitch + vertical * this.sensitivity, -MAX_PITCH, MAX_PITCH);
  }

  update(dt: number, input: Input, colliders: readonly THREE.Box3[]): void {
    // Touches réglables dans le menu (par défaut : Ctrl ou C pour s'accroupir, Maj pour marcher).
    this.updateDuck(dt, input.isDown('crouch'), colliders);
    const walking = input.isDown('walk');

    const forward = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    const side = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Avant = -z quand yaw vaut 0 ; droite = +x.
    this.wishDir.set(-sin * forward + cos * side, 0, -cos * forward - sin * side);
    const speedScale = this.crouched ? MOVE.duckSpeedScale : walking ? MOVE.walkSpeedScale : 1;
    const wishSpeed = this.wishDir.lengthSq() > 0 ? MOVE.maxSpeed * speedScale : 0;
    this.wishDir.normalize();

    const jump = input.consumePress('jump');
    if (this.onGround && jump) {
      this.velocity.y = MOVE.jumpSpeed;
      this.onGround = false;
    }

    if (this.onGround) {
      this.applyFriction(dt);
      this.accelerate(wishSpeed, MOVE.accelerate * wishSpeed * dt, wishSpeed);
    } else {
      this.accelerate(Math.min(wishSpeed, MOVE.airSpeedCap), MOVE.airAccelerate * wishSpeed * dt, wishSpeed);
    }

    this.velocity.y -= MOVE.gravity * dt;
    this.velocity.clampLength(0, MAX_VELOCITY);
    this.move(dt, colliders);
    // La caméra rattrape en douceur la hauteur gagnée sur les marches.
    this.stepOffset *= Math.exp(-STEP_SMOOTHING * dt);
  }

  /**
   * Au sol, on s'accroupit en `duckTime` : la caméra descend, puis la boîte
   * rapetisse par le haut. En l'air, c'est immédiat et ce sont les jambes qui
   * remontent : le saut accroupi permet d'atteindre plus haut, comme dans CS.
   */
  private updateDuck(dt: number, wantDuck: boolean, colliders: readonly THREE.Box3[]): void {
    if (wantDuck) {
      this.duckAmount = Math.min(1, this.duckAmount + dt / MOVE.duckTime);
      if (!this.crouched && (this.duckAmount >= 1 || !this.onGround)) this.finishDuck();
      return;
    }
    if (this.crouched) this.tryStand(colliders);
    if (!this.crouched) this.duckAmount = Math.max(0, this.duckAmount - dt / MOVE.duckTime);
  }

  private finishDuck(): void {
    if (!this.onGround) this.shiftFeet(PLAYER.height - PLAYER.duckHeight);
    this.height = PLAYER.duckHeight;
    this.crouched = true;
    this.duckAmount = 1;
    this.updateBox();
  }

  /** Se relève s'il y a la place au-dessus (sinon on reste accroupi sous l'obstacle). */
  private tryStand(colliders: readonly THREE.Box3[]): void {
    const legs = PLAYER.height - PLAYER.duckHeight;
    if (this.onGround) {
      if (!this.fits(this.position.y, PLAYER.height, colliders)) return;
    } else if (this.fits(this.position.y - legs, PLAYER.height, colliders)) {
      // En l'air, on redéplie les jambes vers le bas : les yeux restent à la même hauteur.
      this.shiftFeet(-legs);
      this.duckAmount = 0;
    } else if (!this.fits(this.position.y, PLAYER.height, colliders)) {
      return;
    }
    this.height = PLAYER.height;
    this.crouched = false;
    this.updateBox();
  }

  private shiftFeet(dy: number): void {
    this.position.y += dy;
    this.previousPosition.y += dy;
  }

  private applyFriction(dt: number): void {
    const speed = this.horizontalSpeed;
    if (speed < 1e-4) return;
    const control = Math.max(speed, MOVE.stopSpeed);
    const newSpeed = Math.max(speed - control * MOVE.friction * dt, 0);
    const scale = newSpeed / speed;
    this.velocity.x *= scale;
    this.velocity.z *= scale;
  }

  /** Ajoute de la vitesse dans la direction voulue, sans dépasser `targetSpeed` sur cet axe. */
  private accelerate(targetSpeed: number, maxGain: number, wishSpeed: number): void {
    if (wishSpeed === 0) return;
    const current = this.velocity.x * this.wishDir.x + this.velocity.z * this.wishDir.z;
    const add = targetSpeed - current;
    if (add <= 0) return;
    const gain = Math.min(maxGain, add);
    this.velocity.x += gain * this.wishDir.x;
    this.velocity.z += gain * this.wishDir.z;
  }

  eyePosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.position).setY(this.position.y + this.eyeHeight);
  }

  /**
   * Place la caméra à hauteur des yeux, en interpolant entre deux ticks.
   * `punch` est le recul de l'arme, ajouté à la direction du regard.
   */
  applyToCamera(camera: THREE.PerspectiveCamera, alpha: number, punch: { pitch: number; yaw: number }): void {
    camera.position.lerpVectors(this.previousPosition, this.position, alpha);
    camera.position.y += this.eyeHeight + this.stepOffset;
    camera.rotation.set(this.pitch + punch.pitch, this.yaw + punch.yaw, 0, 'YXZ');
  }
}
