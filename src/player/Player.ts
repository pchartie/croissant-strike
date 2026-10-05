import * as THREE from 'three';
import { CAMERA, MOVE, PLAYER } from '../config';
import type { Input } from '../core/Input';
import type { World } from '../world/World';

const MAX_PITCH = THREE.MathUtils.degToRad(89);
const AXES = ['x', 'z', 'y'] as const;

/**
 * Joueur avec les déplacements de Counter-Strike: Source : frottement au sol,
 * accélération limitée, contrôle en l'air (air strafe) et saut à l'appui.
 */
export class Player {
  /** Position des pieds, au centre de la boîte de collision. */
  readonly position = new THREE.Vector3();
  readonly previousPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;

  private readonly wishDir = new THREE.Vector3();
  private readonly box = new THREE.Box3();

  constructor(private readonly world: World) {}

  spawn(position: THREE.Vector3, yaw: number): void {
    this.position.copy(position);
    this.previousPosition.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * CAMERA.sensitivity;
    // Axe vertical inversé : pousser la souris vers l'avant fait regarder en bas.
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * CAMERA.sensitivity, -MAX_PITCH, MAX_PITCH);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  update(dt: number, input: Input): void {
    this.previousPosition.copy(this.position);

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
    this.moveAndCollide(dt);
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

  /** Déplace axe par axe et repousse le joueur hors des blocs qu'il touche. */
  private moveAndCollide(dt: number): void {
    this.onGround = false;
    for (const axis of AXES) {
      const delta = this.velocity[axis] * dt;
      if (delta === 0) continue;
      this.position[axis] += delta;
      this.updateBox();

      for (const collider of this.world.colliders) {
        if (!overlaps(this.box, collider)) continue;
        const offset = axis === 'y' ? 0 : PLAYER.radius;
        if (delta > 0) {
          this.position[axis] = collider.min[axis] - (axis === 'y' ? PLAYER.height : offset);
        } else {
          this.position[axis] = collider.max[axis] + offset;
          if (axis === 'y') this.onGround = true;
        }
        this.velocity[axis] = 0;
        this.updateBox();
      }
    }
  }

  private updateBox(): void {
    const { x, y, z } = this.position;
    this.box.min.set(x - PLAYER.radius, y, z - PLAYER.radius);
    this.box.max.set(x + PLAYER.radius, y + PLAYER.height, z + PLAYER.radius);
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

/** Chevauchement strict : se toucher sans s'enfoncer ne compte pas. */
function overlaps(a: THREE.Box3, b: THREE.Box3): boolean {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}
