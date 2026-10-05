import * as THREE from 'three';
import { GRENADE_PHYSICS, GRENADES, type GrenadeType } from './definitions';
import { buildGrenadeModel } from './models';

/** Lanceur d'une grenade autre que le joueur (un bot), repéré par son nom. */
export interface GrenadeOwner {
  name: string;
}

/** Au-delà de ce déplacement par sous-pas, on découpe le mouvement (pas de traversée de mur). */
const MAX_STEP = 0.08;
/** En dessous de cette vitesse au sol, la grenade s'arrête. */
const REST_SPEED = 0.25;
/** Le lanceur ne rebondit pas sur sa propre grenade juste après le lancer. */
const THROWER_GRACE = 0.25;
/** Choc plus doux que ça : la grenade roule ou glisse au lieu de rebondir. */
const ROLL_SPEED = 1;
/** Ralentissement en roulant (par seconde). */
const ROLL_FRICTION = 2.5;

export interface ImpactInfo {
  /** Vitesse du choc, perpendiculaire à la surface (pour le bruit de rebond). */
  speed: number;
  /** Vrai si la surface touchée est un sol (normale vers le haut). */
  floor: boolean;
}

/** Une grenade en vol : rebondit sur les obstacles, ralentit au sol puis s'arrête. */
export class Projectile {
  readonly mesh: THREE.Group;
  age = 0;
  resting = false;

  private readonly spin = new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
  private readonly closest = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();

  constructor(
    readonly type: GrenadeType,
    readonly position: THREE.Vector3,
    readonly velocity: THREE.Vector3,
    /** Boîte du lanceur, ignorée pendant un court instant. */
    private readonly throwerBox: THREE.Box3 | null,
    /** Qui l'a lancée : null pour le joueur, sinon un bot (pour savoir qui a fait des dégâts). */
    readonly owner: GrenadeOwner | null = null,
  ) {
    this.mesh = buildGrenadeModel(type);
    this.mesh.position.copy(position);
  }

  get def() {
    return GRENADES[this.type];
  }

  /** Avance d'un tick. `onImpact` est appelé à chaque rebond. */
  update(dt: number, colliders: readonly THREE.Box3[], onImpact: (info: ImpactInfo) => void): void {
    this.age += dt;
    if (this.resting) return;

    this.velocity.y -= GRENADE_PHYSICS.gravity * dt;
    const distance = this.velocity.length() * dt;
    const steps = Math.max(1, Math.ceil(distance / MAX_STEP));
    for (let i = 0; i < steps; i++) {
      this.position.addScaledVector(this.velocity, dt / steps);
      for (const box of colliders) {
        if (box === this.throwerBox && this.age < THROWER_GRACE) continue;
        this.collide(box, dt, onImpact);
      }
    }

    this.mesh.position.copy(this.position);
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.y += this.spin.y * dt;
    this.mesh.rotation.z += this.spin.z * dt;
  }

  /** Rebond sur une boîte : on ressort la grenade et on renvoie sa vitesse avec de l'amorti. */
  private collide(box: THREE.Box3, dt: number, onImpact: (info: ImpactInfo) => void): void {
    const r = GRENADE_PHYSICS.radius;
    box.clampPoint(this.position, this.closest);
    const offset = this.normal.subVectors(this.position, this.closest);
    let distance = offset.length();
    if (distance >= r) return;

    if (distance < 1e-6) {
      // Centre déjà dans la boîte : on sort par la face la plus proche.
      const faces = [
        [this.position.x - box.min.x, -1, 0, 0],
        [box.max.x - this.position.x, 1, 0, 0],
        [this.position.y - box.min.y, 0, -1, 0],
        [box.max.y - this.position.y, 0, 1, 0],
        [this.position.z - box.min.z, 0, 0, -1],
        [box.max.z - this.position.z, 0, 0, 1],
      ].sort((a, b) => a[0] - b[0])[0];
      this.normal.set(faces[1], faces[2], faces[3]);
      this.position.addScaledVector(this.normal, faces[0]);
      distance = 0;
    } else {
      this.normal.divideScalar(distance);
    }
    this.position.addScaledVector(this.normal, r - distance + 1e-4);

    const into = this.velocity.dot(this.normal);
    if (into >= 0) return;
    const speed = -into;
    const normalPart = this.normal.clone().multiplyScalar(into);
    const tangent = this.velocity.clone().sub(normalPart);
    if (speed < ROLL_SPEED) {
      // Contact doux : la grenade roule, sans rebondir, en ralentissant peu à peu.
      tangent.multiplyScalar(Math.exp(-ROLL_FRICTION * dt));
      this.velocity.copy(tangent);
    } else {
      // Vrai rebond : composante normale renvoyée avec l'élasticité, tangente freinée.
      tangent.multiplyScalar(1 - GRENADE_PHYSICS.friction);
      this.velocity.copy(tangent).addScaledVector(normalPart, -GRENADE_PHYSICS.elasticity);
    }

    const floor = this.normal.y > 0.7;
    if (floor && this.velocity.length() < REST_SPEED) {
      this.velocity.set(0, 0, 0);
      this.resting = true;
    }
    onImpact({ speed, floor });
  }
}
