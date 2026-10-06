import * as THREE from 'three';
import { BotModel } from '../bots/BotModel';
import { MOVE, PLAYER } from '../config';
import type { WeaponId } from '../weapons/definitions';
import type { NetMessage } from './protocol';

/**
 * On affiche l'adversaire avec ce retard : on a alors presque toujours deux
 * positions reçues entre lesquelles glisser, pour un mouvement fluide malgré
 * des messages espacés et irréguliers (comme l'interpolation de CS).
 */
const INTERP_DELAY_MS = 100;
const MAX_SNAPSHOTS = 40;
/** Au-delà, on ne devine plus : on reste sur la dernière position connue. */
const MAX_EXTRAPOLATION_MS = 150;
const FALL_DURATION = 0.35;

type State = Extract<NetMessage, { t: 'state' }>;

interface Snapshot {
  time: number;
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  eye: number;
  ground: boolean;
}

/** L'autre joueur : son modèle, ses zones de touche et sa position lissée. */
export class RemotePlayer {
  readonly model = new BotModel('enemy');
  /** Boîte de collision, pour ne pas lui passer au travers. */
  readonly box = new THREE.Box3();
  readonly position = new THREE.Vector3();
  name = 'Adversaire';
  alive = false;
  weapon: WeaponId = 'rifle';
  yaw = 0;
  pitch = 0;
  eyeHeight = PLAYER.eyeHeight;
  onGround = true;
  /** Vitesse horizontale affichée (pour les pas et l'animation des jambes). */
  speed = 0;
  /** Vrai dès qu'on a reçu au moins une position. */
  private seen = false;
  private deadTime = 0;
  private readonly snapshots: Snapshot[] = [];
  private readonly previous = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(scene: THREE.Scene) {
    for (const hitbox of this.model.hitboxes) hitbox.userData.remote = this;
    this.model.root.visible = false;
    scene.add(this.model.root);
  }

  /** Zones touchables (aucune s'il est mort ou pas encore là). */
  get hitboxes(): THREE.Mesh[] {
    return this.alive && this.seen ? this.model.hitboxes : [];
  }

  get height(): number {
    return this.eyeHeight + (PLAYER.height - PLAYER.eyeHeight);
  }

  receive(state: State, now = performance.now()): void {
    const [x, y, z] = state.p;
    const revived = state.alive && !this.alive;
    // Réapparition : pas de glissade depuis l'endroit de sa mort.
    if (revived) this.snapshots.length = 0;
    this.snapshots.push({ time: now, position: new THREE.Vector3(x, y, z), yaw: state.yaw, pitch: state.pitch, eye: state.eye, ground: state.ground });
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    if (state.alive !== this.alive) this.deadTime = 0;
    this.alive = state.alive;
    this.weapon = state.weapon;
    this.seen = true;
  }

  /** Fait disparaître l'adversaire (déconnexion). */
  reset(): void {
    this.snapshots.length = 0;
    this.seen = false;
    this.alive = false;
    this.model.root.visible = false;
  }

  /** Place le modèle à sa position d'il y a `INTERP_DELAY_MS`, en glissant entre deux positions reçues. */
  update(dt: number, now = performance.now()): void {
    if (!this.seen || this.snapshots.length === 0) return;
    this.model.root.visible = true;
    this.previous.copy(this.position);
    this.sample(now - INTERP_DELAY_MS);
    this.speed = dt > 0 ? Math.hypot(this.position.x - this.previous.x, this.position.z - this.previous.z) / dt : 0;

    if (!this.alive) {
      this.deadTime += dt;
      this.model.root.position.copy(this.position);
      this.model.fall(Math.min(this.deadTime / FALL_DURATION, 1));
      this.model.root.updateMatrixWorld();
      this.box.makeEmpty();
      return;
    }
    // Accroupi : le modèle (et ses zones de touche) se tasse comme sa vue.
    this.model.root.scale.y = this.eyeHeight / PLAYER.eyeHeight;
    this.model.pose(this.position, this.yaw, this.pitch, Math.min(this.speed / MOVE.maxSpeed, 1), dt);
    this.model.root.updateMatrixWorld();
    this.box.min.set(this.position.x - PLAYER.radius, this.position.y, this.position.z - PLAYER.radius);
    this.box.max.set(this.position.x + PLAYER.radius, this.position.y + this.height, this.position.z + PLAYER.radius);
  }

  showFlash(): void {
    this.model.showFlash();
  }

  muzzle(target: THREE.Vector3): THREE.Vector3 {
    return this.model.muzzle.getWorldPosition(target);
  }

  eyePosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.position).setY(this.position.y + this.eyeHeight);
  }

  /** Direction du regard. */
  forward(target: THREE.Vector3): THREE.Vector3 {
    this.euler.set(this.pitch, this.yaw, 0);
    return target.set(0, 0, -1).applyEuler(this.euler);
  }

  private sample(time: number): void {
    const snapshots = this.snapshots;
    // Les deux positions qui encadrent `time` (ou la plus récente, s'il n'y en a pas après).
    let i = snapshots.length - 1;
    while (i > 0 && snapshots[i - 1].time > time) i--;
    const after = snapshots[i];
    const before = i > 0 ? snapshots[i - 1] : null;
    if (!before || time >= after.time) {
      // En retard sur les messages : on prolonge un peu le dernier mouvement connu, sans plus.
      const last = snapshots[snapshots.length - 1];
      const prev = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
      const ahead = Math.min(time - last.time, MAX_EXTRAPOLATION_MS);
      this.apply(last);
      if (prev && ahead > 0 && last.time > prev.time) {
        const k = ahead / (last.time - prev.time);
        this.position.x += (last.position.x - prev.position.x) * k;
        this.position.z += (last.position.z - prev.position.z) * k;
      }
      return;
    }
    const t = THREE.MathUtils.clamp((time - before.time) / Math.max(after.time - before.time, 1), 0, 1);
    this.position.lerpVectors(before.position, after.position, t);
    this.yaw = before.yaw + angleDelta(before.yaw, after.yaw) * t;
    this.pitch = THREE.MathUtils.lerp(before.pitch, after.pitch, t);
    this.eyeHeight = THREE.MathUtils.lerp(before.eye, after.eye, t);
    this.onGround = after.ground;
  }

  private apply(snapshot: Snapshot): void {
    this.position.copy(snapshot.position);
    this.yaw = snapshot.yaw;
    this.pitch = snapshot.pitch;
    this.eyeHeight = snapshot.eye;
    this.onGround = snapshot.ground;
  }
}

/** Plus petit écart entre deux angles (pour ne pas tourner du mauvais côté en passant de -π à π). */
function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
