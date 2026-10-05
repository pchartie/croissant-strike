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

/**
 * Joueur avec les déplacements de Counter-Strike: Source : frottement au sol,
 * accélération limitée, contrôle en l'air (air strafe) et saut à l'appui.
 */
export class Player extends Body {
  yaw = 0;
  pitch = 0;
  health = MAX_HEALTH;

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
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * CAMERA.sensitivity;
    // Axe vertical inversé : pousser la souris vers l'avant fait regarder en bas.
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * CAMERA.sensitivity, -MAX_PITCH, MAX_PITCH);
  }

  update(dt: number, input: Input, colliders: readonly THREE.Box3[]): void {
    const forward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const side = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Avant = -z quand yaw vaut 0 ; droite = +x.
    this.wishDir.set(-sin * forward + cos * side, 0, -cos * forward - sin * side);
    const wishSpeed = this.wishDir.lengthSq() > 0 ? MOVE.maxSpeed : 0;
    this.wishDir.normalize();

    const jump = input.consumePress('Space');
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
    return target.copy(this.position).setY(this.position.y + PLAYER.eyeHeight);
  }

  /**
   * Place la caméra à hauteur des yeux, en interpolant entre deux ticks.
   * `punch` est le recul de l'arme, ajouté à la direction du regard.
   */
  applyToCamera(camera: THREE.PerspectiveCamera, alpha: number, punch: { pitch: number; yaw: number }): void {
    camera.position.lerpVectors(this.previousPosition, this.position, alpha);
    camera.position.y += PLAYER.eyeHeight;
    camera.rotation.set(this.pitch + punch.pitch, this.yaw + punch.yaw, 0, 'YXZ');
  }
}
