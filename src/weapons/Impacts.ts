import * as THREE from 'three';

const MAX_DECALS = 120;
const MAX_PARTICLES = 400;
const PARTICLES_PER_HIT = 8;
const PARTICLE_LIFE = 0.45;
const GRAVITY = 9.8;
const HIDDEN_Y = -1000;

/** Impacts de balles : trous dans les surfaces et petits éclats de poussière. */
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

  private readonly positions = new Float32Array(MAX_PARTICLES * 3).fill(HIDDEN_Y);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly lives = new Float32Array(MAX_PARTICLES);
  private nextParticle = 0;
  private readonly points: THREE.Points;

  private readonly normal = new THREE.Vector3();
  private static readonly FORWARD = new THREE.Vector3(0, 0, 1);

  constructor(private readonly scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0xbcae92, size: 0.035, transparent: true, opacity: 0.9 }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  add(hit: THREE.Intersection): void {
    if (!hit.face) return;
    this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    this.addDecal(hit.point, this.normal);
    this.addDust(hit.point, this.normal);
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

  private addDust(point: THREE.Vector3, normal: THREE.Vector3): void {
    for (let n = 0; n < PARTICLES_PER_HIT; n++) {
      const i = this.nextParticle;
      this.nextParticle = (this.nextParticle + 1) % MAX_PARTICLES;
      const speed = 1 + Math.random() * 2.5;
      this.positions.set([point.x, point.y, point.z], i * 3);
      this.velocities.set(
        [
          (normal.x + (Math.random() - 0.5) * 1.2) * speed,
          (normal.y + (Math.random() - 0.5) * 1.2) * speed + 1,
          (normal.z + (Math.random() - 0.5) * 1.2) * speed,
        ],
        i * 3,
      );
      this.lives[i] = PARTICLE_LIFE * (0.6 + Math.random() * 0.4);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
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
