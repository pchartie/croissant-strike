import * as THREE from 'three';
import { surfaceOf, type Surface } from '../world/surfaces';

const MAX_DECALS = 120;
const GRAVITY = 9.8;
const HIDDEN_Y = -1000;

/** Impacts de balles : trous dans les surfaces, poussière et sang. */
export class Impacts {
  private readonly decals: THREE.Mesh[] = [];
  private nextDecal = 0;
  private readonly decalGeometry = new THREE.PlaneGeometry(0.07, 0.07);
  private readonly decalMaterial = new THREE.MeshStandardMaterial({
    map: holeTexture(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    roughness: 1,
  });

  private readonly dust: Particles;
  private readonly sand: Particles;
  private readonly chips: Particles;
  private readonly sparks: Particles;
  private readonly blood: Particles;
  private readonly normal = new THREE.Vector3();
  private static readonly FORWARD = new THREE.Vector3(0, 0, 1);

  constructor(private readonly scene: THREE.Scene) {
    this.dust = new Particles(scene, 400, 0xbcae92, 0.035);
    this.sand = new Particles(scene, 300, 0xc9ad7f, 0.045);
    this.chips = new Particles(scene, 200, 0x6b4526, 0.03);
    this.sparks = new Particles(scene, 200, 0xffc46b, 0.03, true);
    this.blood = new Particles(scene, 300, 0x8a0f0a, 0.05);
  }

  /** Balle dans un mur ou un objet : trou, et éclats selon la matière (renvoyée pour le son). */
  add(hit: THREE.Intersection): Surface {
    const surface = surfaceOf(hit.object);
    if (!hit.face) return surface;
    this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    this.addDecal(hit.point, this.normal);
    switch (surface) {
      case 'metal':
        // Étincelles rapides et brèves.
        this.sparks.burst(hit.point, this.normal, 10, 3, 7, 0.25);
        break;
      case 'wood':
        this.chips.burst(hit.point, this.normal, 8, 1.5, 3.5, 0.6);
        this.dust.burst(hit.point, this.normal, 4, 0.5, 1.5, 0.4);
        break;
      case 'sand':
        // Petite gerbe de sable qui retombe.
        this.sand.burst(hit.point, this.normal, 14, 1, 3, 0.7);
        break;
      default:
        this.dust.burst(hit.point, this.normal, 8, 1, 2.5, 0.45);
        this.sparks.burst(hit.point, this.normal, 2, 2, 5, 0.12);
    }
    return surface;
  }

  /** Balle dans un bot : giclée de sang dans le sens du tir. */
  addBlood(point: THREE.Vector3, direction: THREE.Vector3, amount = 10): void {
    this.blood.burst(point, direction, amount, 0.5, 2, 0.5);
  }

  update(dt: number): void {
    for (const particles of [this.dust, this.sand, this.chips, this.sparks, this.blood]) particles.update(dt);
  }

  private addDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    let decal = this.decals[this.nextDecal];
    if (!decal) {
      decal = new THREE.Mesh(this.decalGeometry, this.decalMaterial);
      decal.receiveShadow = true;
      this.decals.push(decal);
      this.scene.add(decal);
    }
    this.nextDecal = (this.nextDecal + 1) % MAX_DECALS;

    decal.position.copy(point).addScaledVector(normal, 0.002);
    decal.quaternion.setFromUnitVectors(Impacts.FORWARD, normal);
    decal.rotateZ(Math.random() * Math.PI * 2);
    decal.scale.setScalar(0.8 + Math.random() * 0.4);
  }
}

/** Petites particules qui jaillissent puis retombent. */
class Particles {
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly lives: Float32Array;
  private next = 0;
  private readonly points: THREE.Points;

  constructor(scene: THREE.Scene, private readonly max: number, color: number, size: number, glowing = false) {
    this.positions = new Float32Array(max * 3).fill(HIDDEN_Y);
    this.velocities = new Float32Array(max * 3);
    this.lives = new Float32Array(max);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    // Les étincelles brillent (mélange additif) ; la poussière et les éclats non.
    const blending = glowing ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, blending, depthWrite: !glowing }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(point: THREE.Vector3, direction: THREE.Vector3, count: number, minSpeed: number, maxSpeed: number, life: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
      this.positions.set([point.x, point.y, point.z], i * 3);
      this.velocities.set(
        [
          (direction.x + (Math.random() - 0.5) * 1.2) * speed,
          (direction.y + (Math.random() - 0.5) * 1.2) * speed + 1,
          (direction.z + (Math.random() - 0.5) * 1.2) * speed,
        ],
        i * 3,
      );
      this.lives[i] = life * (0.6 + Math.random() * 0.4);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.lives[i] <= 0) continue;
      this.lives[i] -= dt;
      const p = i * 3;
      if (this.lives[i] <= 0) {
        this.positions[p + 1] = HIDDEN_Y;
        continue;
      }
      this.velocities[p + 1] -= GRAVITY * dt;
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

function holeTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(8, 7, 6, 1)');
  gradient.addColorStop(0.28, 'rgba(15, 13, 11, 1)');
  gradient.addColorStop(0.45, 'rgba(45, 40, 34, 0.7)');
  gradient.addColorStop(1, 'rgba(60, 52, 44, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
