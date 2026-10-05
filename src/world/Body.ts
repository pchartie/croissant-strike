import * as THREE from 'three';
import { MOVE } from '../config';

const AXES = ['x', 'z', 'y'] as const;
/**
 * Petit écart laissé entre un corps et un obstacle après une collision. Sans
 * lui, les arrondis de calcul laissent le corps « dans » l'obstacle d'un
 * cheveu, et la collision suivante sur un autre axe le téléporte dessus ou
 * dessous.
 */
const SKIN = 1e-4;

/** Corps en forme de boîte verticale (joueur, bot) qui se cogne aux obstacles. */
export class Body {
  /** Position des pieds, au centre de la boîte de collision. */
  readonly position = new THREE.Vector3();
  readonly previousPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Boîte de collision actuelle, utilisable comme obstacle par les autres corps. */
  readonly box = new THREE.Box3();
  onGround = false;
  /**
   * Hauteur gagnée en montant une marche, pas encore rattrapée par la caméra :
   * elle rattrape en douceur au lieu de sauter d'un coup à chaque marche.
   */
  stepOffset = 0;

  constructor(
    readonly radius: number,
    readonly height: number,
  ) {}

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  teleport(position: THREE.Vector3): void {
    this.position.copy(position);
    this.previousPosition.copy(position);
    this.velocity.set(0, 0, 0);
    this.stepOffset = 0;
    this.updateBox();
  }

  /**
   * Déplace axe par axe et repousse le corps hors des obstacles qu'il touche.
   * Au sol, un obstacle assez bas (une marche) est franchi au lieu de bloquer.
   */
  move(dt: number, colliders: readonly THREE.Box3[]): void {
    this.previousPosition.copy(this.position);
    const canStep = this.onGround;
    this.onGround = false;
    for (const axis of AXES) {
      const delta = this.velocity[axis] * dt;
      if (delta === 0) continue;
      this.position[axis] += delta;
      this.updateBox();

      for (const collider of colliders) {
        if (collider === this.box || !overlaps(this.box, collider)) continue;
        if (axis !== 'y' && canStep && this.stepUp(collider, colliders)) continue;
        const below = axis === 'y' ? this.height : this.radius;
        const above = axis === 'y' ? 0 : this.radius;
        if (delta > 0) {
          this.position[axis] = collider.min[axis] - below - SKIN;
        } else {
          this.position[axis] = collider.max[axis] + above + SKIN;
          if (axis === 'y') this.onGround = true;
        }
        this.velocity[axis] = 0;
        this.updateBox();
      }
    }
  }

  /** Monte sur l'obstacle s'il est assez bas et qu'il y a la place au-dessus. */
  private stepUp(obstacle: THREE.Box3, colliders: readonly THREE.Box3[]): boolean {
    const rise = obstacle.max.y - this.position.y;
    if (rise <= 0 || rise > MOVE.stepSize) return false;

    const startY = this.position.y;
    this.position.y = obstacle.max.y + SKIN;
    this.updateBox();
    for (const other of colliders) {
      if (other !== this.box && overlaps(this.box, other)) {
        this.position.y = startY;
        this.updateBox();
        return false;
      }
    }
    this.stepOffset -= this.position.y - startY;
    return true;
  }

  private updateBox(): void {
    const { x, y, z } = this.position;
    this.box.min.set(x - this.radius, y, z - this.radius);
    this.box.max.set(x + this.radius, y + this.height, z + this.radius);
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
