import * as THREE from 'three';
import { flashTexture } from '../weapons/flash';
import { MOLOTOV, SMOKE } from './definitions';

const SMOKE_PUFFS = 34;
const FLAMES = 26;
const EXPLOSION_TIME = 0.35;

/** Nuage de fumigène : grossit, dure 18 s, puis se dissipe. Bloque la vue des bots. */
export class SmokeCloud {
  readonly group = new THREE.Group();
  age = 0;
  private readonly puffs: { sprite: THREE.Sprite; offset: THREE.Vector3; size: number; spin: number }[] = [];

  constructor(readonly center: THREE.Vector3) {
    const texture = smokeTexture();
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      // Points répartis dans une demi-sphère un peu aplatie, posée au sol.
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 0.9, Math.random() * 2 - 1).normalize();
      const offset = dir.multiplyScalar(SMOKE.radius * (0.15 + Math.random() * 0.65));
      const material = new THREE.SpriteMaterial({ map: texture, color: 0xcfcfcf, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(material);
      this.group.add(sprite);
      this.puffs.push({ sprite, offset, size: SMOKE.radius * (0.9 + Math.random() * 0.6), spin: (Math.random() - 0.5) * 0.2 });
    }
    this.group.position.copy(center);
  }

  get finished(): boolean {
    return this.age >= SMOKE.duration;
  }

  /** Rayon actuel du nuage (pour bloquer la vue). */
  get radius(): number {
    const grow = Math.min(this.age / SMOKE.growTime, 1);
    const fade = Math.min((SMOKE.duration - this.age) / SMOKE.fadeTime, 1);
    return SMOKE.radius * grow * Math.max(fade, 0) * 0.95;
  }

  /** Opacité globale (0 à 1) : sert aussi à griser l'écran quand on est dedans. */
  get density(): number {
    const grow = Math.min(this.age / SMOKE.growTime, 1);
    const fade = Math.min((SMOKE.duration - this.age) / SMOKE.fadeTime, 1);
    return Math.max(0, Math.min(grow, fade));
  }

  update(dt: number): void {
    this.age += dt;
    const grow = Math.min(this.age / SMOKE.growTime, 1);
    const ease = 1 - (1 - grow) * (1 - grow);
    for (const puff of this.puffs) {
      puff.sprite.position.copy(puff.offset).multiplyScalar(ease);
      puff.sprite.position.y += 0.6;
      puff.sprite.scale.setScalar(puff.size * (0.4 + 0.6 * ease));
      puff.sprite.material.rotation += puff.spin * dt;
      puff.sprite.material.opacity = 0.85 * this.density;
    }
  }

  /** Vrai si le segment de a à b traverse le nuage. */
  blocks(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const radius = this.radius;
    if (radius <= 0.2) return false;
    const center = this.center.clone().setY(this.center.y + 0.9);
    const ab = b.clone().sub(a);
    const t = THREE.MathUtils.clamp(center.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
    return a.clone().addScaledVector(ab, t).distanceTo(center) < radius;
  }

  contains(point: THREE.Vector3): boolean {
    return point.distanceTo(this.center.clone().setY(this.center.y + 0.9)) < this.radius;
  }
}

/** Zone de feu de molotov : flammes au sol pendant 7 s. */
export class FireArea {
  readonly group = new THREE.Group();
  age = 0;
  extinguished = false;
  /** Intensité de la lumière des flammes (une lumière partagée l'affiche). */
  glow = 0;
  private readonly flames: { sprite: THREE.Sprite; base: number; phase: number }[] = [];

  constructor(readonly center: THREE.Vector3) {
    const texture = flameTexture();
    for (let i = 0; i < FLAMES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * MOLOTOV.radius * 0.9;
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
      this.group.add(sprite);
      this.flames.push({ sprite, base: 0.6 + Math.random() * 0.7, phase: Math.random() * 10 });
    }
    this.group.position.copy(center);
  }

  get finished(): boolean {
    return this.extinguished || this.age >= MOLOTOV.duration;
  }

  /** Vrai si un corps aux pieds en `feet` est dans les flammes. */
  burns(feet: THREE.Vector3): boolean {
    if (this.finished) return false;
    const dx = feet.x - this.center.x;
    const dz = feet.z - this.center.z;
    return dx * dx + dz * dz < MOLOTOV.radius * MOLOTOV.radius && Math.abs(feet.y - this.center.y) < 0.8;
  }

  update(dt: number): void {
    this.age += dt;
    // Les flammes s'étendent au début et faiblissent à la fin.
    const grow = Math.min(this.age / 0.4, 1);
    const fade = Math.min((MOLOTOV.duration - this.age) / 1, 1);
    const strength = Math.max(0, Math.min(grow, fade));
    for (const flame of this.flames) {
      const flicker = 0.75 + 0.25 * Math.sin(this.age * 14 + flame.phase) + 0.1 * Math.sin(this.age * 31 + flame.phase * 2);
      const size = flame.base * flicker * strength;
      flame.sprite.scale.set(size, size * 1.4, 1);
      flame.sprite.position.y = size * 0.6;
    }
    this.glow = 30 * strength * (0.8 + 0.2 * Math.sin(this.age * 23));
  }
}

/** Explosion : boule de feu, fumée et éclair pour une HE ; simple éclair blanc pour une flash. */
export class Explosion {
  readonly group = new THREE.Group();
  age = 0;
  /** Intensité de l'éclair lumineux (une lumière partagée l'affiche). */
  glow = 120;
  private readonly fireball: THREE.Sprite;
  private readonly puffs: { sprite: THREE.Sprite; velocity: THREE.Vector3 }[] = [];

  constructor(
    center: THREE.Vector3,
    private readonly kind: 'he' | 'flash' = 'he',
  ) {
    const color = kind === 'flash' ? 0xeef4ff : 0xffffff;
    this.fireball = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flashTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.fireball.position.y = 0.5;
    this.group.add(this.fireball);

    const texture = smokeTexture();
    for (let i = 0; i < (kind === 'he' ? 10 : 0); i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0x5a5148, transparent: true, depthWrite: false }));
      const velocity = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.5 + 0.5, Math.random() * 2 - 1).multiplyScalar(2);
      sprite.position.y = 0.4;
      this.group.add(sprite);
      this.puffs.push({ sprite, velocity });
    }
    this.group.position.copy(center);
  }

  get finished(): boolean {
    return this.age > 1.6;
  }

  update(dt: number): void {
    this.age += dt;
    const t = Math.min(this.age / EXPLOSION_TIME, 1);
    this.fireball.scale.setScalar(this.kind === 'he' ? 1 + 4.5 * t : 2.5 + 1.5 * t);
    this.fireball.material.opacity = 1 - t;
    this.glow = 120 * Math.max(0, 1 - this.age / 0.2);
    for (const puff of this.puffs) {
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      puff.velocity.multiplyScalar(Math.exp(-2.5 * dt));
      puff.sprite.scale.setScalar(1 + this.age * 2.2);
      puff.sprite.material.opacity = Math.max(0, 0.75 * (1 - this.age / 1.6));
    }
  }
}

let smoke: THREE.CanvasTexture | null = null;
let flame: THREE.CanvasTexture | null = null;

/** Bouffée de fumée : disque flou un peu irrégulier. */
function smokeTexture(): THREE.CanvasTexture {
  if (smoke) return smoke;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 6; i++) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.25;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.25;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 0.42);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  smoke = new THREE.CanvasTexture(canvas);
  smoke.colorSpace = THREE.SRGBColorSpace;
  return smoke;
}

/** Flamme : goutte jaune-orange, plus chaude à la base. */
function flameTexture(): THREE.CanvasTexture {
  if (flame) return flame;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size * 0.7, 2, size / 2, size * 0.55, size * 0.45);
  gradient.addColorStop(0, 'rgba(255, 245, 200, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 170, 60, 0.9)');
  gradient.addColorStop(0.75, 'rgba(220, 70, 20, 0.4)');
  gradient.addColorStop(1, 'rgba(120, 20, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  flame = new THREE.CanvasTexture(canvas);
  flame.colorSpace = THREE.SRGBColorSpace;
  return flame;
}
