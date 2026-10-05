import * as THREE from 'three';
import { MOLOTOV, SMOKE } from './definitions';

// Effets visuels des grenades, à base de sprites (images toujours face à la
// caméra) et de particules. Chaque effet expose `group` (à ajouter à la scène),
// `finished`, `update(dt)` et `glow` (intensité de la lumière partagée).

const GRAVITY = 9.8;
const HIDDEN = -1000;

const random = (min: number, max: number) => min + Math.random() * (max - min);

// --- HE (et flash) ---

interface Puff {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  delay: number;
  life: number;
  size: [number, number];
}

/**
 * Explosion. HE : éclair, boule de feu qui monte et vire à la fumée noire,
 * anneau de poussière au sol, étincelles et fumée qui traîne. Flash : éclair
 * blanc et quelques étincelles.
 */
export class Explosion {
  readonly group = new THREE.Group();
  age = 0;
  /** Intensité de l'éclair lumineux (une lumière partagée l'affiche). */
  glow: number;
  private readonly core: THREE.Sprite;
  private readonly fire: Puff[] = [];
  private readonly smoke: Puff[] = [];
  private readonly dust: Puff[] = [];
  private readonly sparks: Sparks;
  private readonly duration: number;

  constructor(
    center: THREE.Vector3,
    private readonly kind: 'he' | 'flash' = 'he',
  ) {
    const he = kind === 'he';
    this.glow = he ? 140 : 220;
    this.duration = he ? 3.5 : 0.6;

    this.core = sprite(glowTexture(), he ? 0xfff0c0 : 0xffffff, THREE.AdditiveBlending);
    this.core.position.y = 0.3;
    this.group.add(this.core);

    if (he) {
      // Flammes : partent vite dans toutes les directions, ralenties par l'air.
      for (let i = 0; i < 16; i++) {
        const dir = new THREE.Vector3(random(-1, 1), random(0.2, 1.2), random(-1, 1)).normalize();
        this.fire.push(this.addPuff(0xffa040, THREE.AdditiveBlending, dir.multiplyScalar(random(3, 7)), 0, random(0.35, 0.6), [0.8, random(2, 3.2)]));
      }
      // Fumée noire qui prend le relais et monte lentement.
      for (let i = 0; i < 14; i++) {
        const velocity = new THREE.Vector3(random(-1.2, 1.2), random(0.8, 2.2), random(-1.2, 1.2));
        this.smoke.push(this.addPuff(0x2e2a26, THREE.NormalBlending, velocity, random(0.08, 0.3), random(2.4, 3.3), [1.2, random(3, 4.5)]));
      }
      // Poussière soulevée qui court au ras du sol.
      for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * Math.PI * 2 + random(-0.15, 0.15);
        const velocity = new THREE.Vector3(Math.cos(angle), 0.08, Math.sin(angle)).multiplyScalar(random(6, 9));
        this.dust.push(this.addPuff(0xb39a76, THREE.NormalBlending, velocity, 0, random(1, 1.5), [0.8, random(2, 3)]));
      }
    }

    this.sparks = new Sparks(he ? 60 : 24, he ? 0xffb347 : 0xffffff, he ? [6, 15] : [3, 7], he ? [0.4, 1] : [0.2, 0.45]);
    this.group.add(this.sparks.points);
    this.group.position.copy(center);
  }

  get finished(): boolean {
    return this.age > this.duration;
  }

  update(dt: number): void {
    this.age += dt;
    const he = this.kind === 'he';

    // Éclair du cœur : très bref.
    const flash = Math.min(this.age / 0.12, 1);
    this.core.scale.setScalar((he ? 2 : 3) + (he ? 5 : 3) * flash);
    this.core.material.opacity = Math.max(0, 1 - this.age / (he ? 0.25 : 0.18));
    this.glow = (he ? 140 : 220) * Math.max(0, 1 - this.age / (he ? 0.3 : 0.15));

    for (const puff of this.fire) this.updatePuff(puff, dt, 2.5, 0);
    for (const puff of this.smoke) this.updatePuff(puff, dt, 0.8, 0.85);
    for (const puff of this.dust) this.updatePuff(puff, dt, 3, 0.55);
    this.sparks.update(dt);
  }

  private addPuff(
    color: number,
    blending: THREE.Blending,
    velocity: THREE.Vector3,
    delay: number,
    life: number,
    size: [number, number],
  ): Puff {
    const s = sprite(cloudTexture(), color, blending);
    s.material.rotation = random(0, Math.PI * 2);
    s.position.y = 0.3;
    s.visible = false;
    this.group.add(s);
    return { sprite: s, velocity, delay, life, size };
  }

  /** Avance une bouffée : freinée par l'air, grossit, et s'efface (`peak` : opacité maximale, 0 pour une flamme). */
  private updatePuff(puff: Puff, dt: number, drag: number, peak: number): void {
    const t = (this.age - puff.delay) / puff.life;
    puff.sprite.visible = t > 0 && t < 1;
    if (!puff.sprite.visible) return;
    puff.sprite.position.addScaledVector(puff.velocity, dt);
    puff.velocity.multiplyScalar(Math.exp(-drag * dt));
    puff.sprite.scale.setScalar(THREE.MathUtils.lerp(puff.size[0], puff.size[1], 1 - (1 - t) * (1 - t)));
    // Les flammes brillent fort puis s'éteignent ; la fumée apparaît en fondu puis s'efface.
    puff.sprite.material.opacity = peak === 0 ? 1 - t : peak * Math.min(t * 6, 1) * (1 - t);
  }
}

// --- Fumigène ---

interface SmokePuff {
  sprite: THREE.Sprite;
  target: THREE.Vector3;
  delay: number;
  size: number;
  spin: number;
  phase: number;
  alpha: number;
}

/**
 * Nuage de fumigène : jaillit de la grenade, gonfle en une masse dense (plus
 * sombre en bas, plus claire en haut) qui tourne lentement, dure 18 s puis se
 * dissipe. Bloque la vue des bots.
 */
export class SmokeCloud {
  readonly group = new THREE.Group();
  age = 0;
  private readonly puffs: SmokePuff[] = [];

  constructor(readonly center: THREE.Vector3) {
    for (let i = 0; i < 70; i++) {
      // Points dans un dôme posé au sol, plus de matière en bas qu'en haut.
      const angle = random(0, Math.PI * 2);
      const distance = Math.sqrt(Math.random()) * SMOKE.radius * 0.8;
      const height = Math.pow(Math.random(), 1.4) * 2.6 + 0.4;
      const target = new THREE.Vector3(Math.cos(angle) * distance, height, Math.sin(angle) * distance);
      const shade = THREE.MathUtils.lerp(0.55, 0.85, height / 3) + random(-0.04, 0.04);
      const color = new THREE.Color().setRGB(shade * 0.97, shade * 0.99, shade * 1.03);
      const s = sprite(cloudTexture(), color, THREE.NormalBlending);
      s.material.rotation = random(0, Math.PI * 2);
      this.group.add(s);
      this.puffs.push({
        sprite: s,
        target,
        // Les bouffées sortent l'une après l'autre, d'abord au centre.
        delay: (distance / SMOKE.radius) * 0.9 + random(0, 0.25),
        size: random(1.7, 2.8),
        spin: random(-0.15, 0.15),
        phase: random(0, Math.PI * 2),
        alpha: random(0.75, 1),
      });
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
    const fade = Math.max(0, Math.min((SMOKE.duration - this.age) / SMOKE.fadeTime, 1));
    for (const puff of this.puffs) {
      const t = Math.min(Math.max((this.age - puff.delay) / 1.1, 0), 1);
      const ease = 1 - Math.pow(1 - t, 3);
      // De la grenade vers sa place, puis de lentes volutes.
      const sway = 0.25 * Math.sin(this.age * 0.4 + puff.phase);
      puff.sprite.position.set(
        puff.target.x * ease + sway,
        0.3 + (puff.target.y - 0.3) * ease + 0.15 * Math.sin(this.age * 0.3 + puff.phase * 2),
        puff.target.z * ease - sway,
      );
      // En se dissipant, la fumée s'étale un peu.
      puff.sprite.scale.setScalar(puff.size * (0.3 + 0.7 * ease) * (1 + 0.25 * (1 - fade)));
      puff.sprite.material.rotation += puff.spin * dt;
      puff.sprite.material.opacity = puff.alpha * 0.92 * Math.min(t * 3, 1) * fade;
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

// --- Molotov ---

interface Flame {
  sprite: THREE.Sprite;
  life: number;
  time: number;
  size: number;
}

/**
 * Feu de molotov : tapis de flammes qui naissent, montent et meurent sans
 * cesse, lueur orange au sol, braises qui s'envolent et fumée sombre au-dessus.
 */
export class FireArea {
  readonly group = new THREE.Group();
  age = 0;
  extinguished = false;
  /** Intensité de la lumière des flammes (une lumière partagée l'affiche). */
  glow = 0;
  private readonly flames: Flame[] = [];
  private readonly smoke: { sprite: THREE.Sprite; time: number; life: number }[] = [];
  private readonly ground: THREE.Mesh;
  private readonly embers: Sparks;

  constructor(readonly center: THREE.Vector3) {
    for (let i = 0; i < 52; i++) {
      const s = sprite(flameTexture(), 0xffffff, THREE.AdditiveBlending);
      this.group.add(s);
      const flame = { sprite: s, life: 0, time: 0, size: 0 };
      this.respawnFlame(flame);
      flame.time = random(0, flame.life);
      this.flames.push(flame);
    }
    for (let i = 0; i < 10; i++) {
      const s = sprite(cloudTexture(), 0x26221f, THREE.NormalBlending);
      s.position.set(random(-1, 1) * MOLOTOV.radius * 0.5, 0.8, random(-1, 1) * MOLOTOV.radius * 0.5);
      this.group.add(s);
      this.smoke.push({ sprite: s, time: random(0, 3), life: random(2.5, 3.5) });
    }

    // Lueur orange posée au sol sous les flammes.
    const glowMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: 0xff7a2a,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(MOLOTOV.radius * 2.6, MOLOTOV.radius * 2.6), glowMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0.03;
    this.group.add(this.ground);

    this.embers = new Sparks(70, 0xff8a30, [0.6, 1.6], [1, 2.2], { gravity: -0.6, spread: MOLOTOV.radius, size: 0.045, continuous: true });
    this.group.add(this.embers.points);
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
    // S'étend en 0,4 s, embrasement plus haut au début, faiblit la dernière seconde.
    const grow = Math.min(this.age / 0.4, 1);
    const fade = Math.max(0, Math.min((MOLOTOV.duration - this.age) / 1, 1));
    const strength = Math.min(grow, fade);
    const burst = 1 + 0.7 * Math.max(0, 1 - this.age / 0.6);

    for (const flame of this.flames) {
      flame.time += dt;
      if (flame.time >= flame.life) this.respawnFlame(flame, grow);
      const t = flame.time / flame.life;
      const size = flame.size * Math.sin(Math.PI * t) * strength * burst;
      flame.sprite.scale.set(size * 0.75, size * 1.5, 1);
      // Chaque flamme monte un peu en vivant.
      flame.sprite.position.y = size * 0.7 + t * 0.35;
      flame.sprite.material.opacity = Math.min(1, 1.6 * Math.sin(Math.PI * t));
    }

    for (const puff of this.smoke) {
      puff.time += dt;
      if (puff.time > puff.life) {
        puff.time = 0;
        puff.sprite.position.set(random(-1, 1) * MOLOTOV.radius * 0.5, 0.8, random(-1, 1) * MOLOTOV.radius * 0.5);
      }
      const t = puff.time / puff.life;
      puff.sprite.position.y += dt * 1.2;
      puff.sprite.scale.setScalar(1.2 + t * 2.5);
      puff.sprite.material.opacity = 0.35 * Math.sin(Math.PI * t) * strength;
    }

    const flicker = 0.85 + 0.15 * Math.sin(this.age * 23) + 0.08 * Math.sin(this.age * 41);
    (this.ground.material as THREE.MeshBasicMaterial).opacity = 0.6 * strength * flicker;
    this.embers.emitting = strength > 0.2;
    this.embers.update(dt);
    this.glow = 32 * strength * flicker;
  }

  /** Nouvelle flamme ailleurs dans la zone (`grow` : la zone s'étend au début). */
  private respawnFlame(flame: Flame, grow = 1): void {
    const angle = random(0, Math.PI * 2);
    const distance = Math.sqrt(Math.random()) * MOLOTOV.radius * 0.92 * Math.max(grow, 0.3);
    flame.sprite.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
    flame.sprite.material.rotation = random(-0.25, 0.25);
    flame.life = random(0.35, 0.75);
    flame.time = 0;
    // Flammes plus hautes au centre de la zone.
    flame.size = random(0.5, 1) * (1.2 - 0.5 * (distance / MOLOTOV.radius));
  }
}

// --- Traces au sol ---

/** Trace noire laissée au sol par une explosion ou un feu, qui s'efface à la fin. */
export class Scorch {
  readonly group = new THREE.Group();
  age = 0;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(
    center: THREE.Vector3,
    size: number,
    private readonly duration: number,
  ) {
    this.material = new THREE.MeshBasicMaterial({
      map: scorchTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.material);
    mesh.rotation.set(-Math.PI / 2, 0, random(0, Math.PI * 2));
    mesh.position.y = 0.012;
    this.group.add(mesh);
    this.group.position.copy(center);
  }

  get finished(): boolean {
    return this.age >= this.duration;
  }

  update(dt: number): void {
    this.age += dt;
    // Apparaît vite, s'efface sur les 3 dernières secondes.
    this.material.opacity = Math.min(this.age / 0.3, 1) * Math.min((this.duration - this.age) / 3, 1);
  }
}

// --- Particules (étincelles, braises) ---

/** Petites particules lumineuses : projetées d'un coup (étincelles) ou en continu (braises). */
class Sparks {
  readonly points: THREE.Points;
  emitting = true;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly lives: Float32Array;
  private readonly gravity: number;
  private readonly spread: number;
  private readonly continuous: boolean;

  constructor(
    private readonly count: number,
    color: number,
    private readonly speed: [number, number],
    private readonly life: [number, number],
    options: { gravity?: number; spread?: number; size?: number; continuous?: boolean } = {},
  ) {
    this.gravity = options.gravity ?? GRAVITY;
    this.spread = options.spread ?? 0;
    this.continuous = options.continuous ?? false;
    this.positions = new Float32Array(count * 3).fill(HIDDEN);
    this.velocities = new Float32Array(count * 3);
    this.lives = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.emit(i);
      // En continu, les braises démarrent décalées pour ne pas partir toutes ensemble.
      if (this.continuous) this.lives[i] = random(0, this.life[1]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color,
        size: options.size ?? 0.06,
        map: glowTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      const p = i * 3;
      if (this.lives[i] <= 0) {
        if (this.continuous && this.emitting) this.emit(i);
        else this.positions[p + 1] = HIDDEN;
        continue;
      }
      this.lives[i] -= dt;
      this.velocities[p + 1] -= this.gravity * dt;
      if (this.continuous) {
        // Les braises dérivent au gré de l'air chaud.
        this.velocities[p] += random(-1, 1) * dt * 2;
        this.velocities[p + 2] += random(-1, 1) * dt * 2;
      }
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  private emit(i: number): void {
    const p = i * 3;
    const angle = random(0, Math.PI * 2);
    const distance = Math.sqrt(Math.random()) * this.spread;
    this.positions.set([Math.cos(angle) * distance, this.continuous ? random(0.1, 0.6) : 0.3, Math.sin(angle) * distance], p);
    const dir = new THREE.Vector3(random(-1, 1), this.continuous ? random(0.6, 1) : random(0.1, 1), random(-1, 1)).normalize();
    const speed = random(...this.speed);
    this.velocities.set([dir.x * speed, dir.y * speed, dir.z * speed], p);
    this.lives[i] = random(...this.life);
  }
}

// --- Textures dessinées par le code (une seule fois chacune) ---

function sprite(texture: THREE.Texture, color: THREE.ColorRepresentation, blending: THREE.Blending): THREE.Sprite {
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color, blending, transparent: true, depthWrite: false }));
}

const cache = new Map<string, THREE.CanvasTexture>();

function canvasTexture(key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  let texture = cache.get(key);
  if (!texture) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d')!);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, texture);
  }
  return texture;
}

/** Nuage cotonneux : beaucoup de petites bosses floues dans un disque. */
function cloudTexture(): THREE.CanvasTexture {
  return canvasTexture('cloud', 128, 128, (ctx) => {
    for (let i = 0; i < 26; i++) {
      const angle = random(0, Math.PI * 2);
      const distance = Math.sqrt(Math.random()) * 30;
      const x = 64 + Math.cos(angle) * distance;
      const y = 64 + Math.sin(angle) * distance;
      const r = random(16, 30);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${random(0.18, 0.3)})`);
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }
  });
}

/** Langue de flamme : cœur clair en bas, pointe rouge en haut. */
function flameTexture(): THREE.CanvasTexture {
  return canvasTexture('flame', 64, 128, (ctx) => {
    for (let i = 0; i < 7; i++) {
      const y = 100 - i * 11;
      const r = 26 - i * 3;
      const x = 32 + random(-3, 3);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      const heat = 1 - i / 7;
      gradient.addColorStop(0, `rgba(255, ${Math.round(200 + 55 * heat)}, ${Math.round(120 * heat)}, ${0.5 * heat + 0.2})`);
      gradient.addColorStop(0.5, `rgba(255, ${Math.round(110 + 60 * heat)}, 30, ${0.3 * heat + 0.1})`);
      gradient.addColorStop(1, 'rgba(200, 40, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 128);
    }
  });
}

/** Halo rond très doux. */
function glowTexture(): THREE.CanvasTexture {
  return canvasTexture('glow', 64, 64, (ctx) => {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.6)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  });
}

/** Trace de brûlure : centre noir, bords irréguliers qui s'estompent. */
function scorchTexture(): THREE.CanvasTexture {
  return canvasTexture('scorch', 128, 128, (ctx) => {
    for (let i = 0; i < 40; i++) {
      const angle = random(0, Math.PI * 2);
      const distance = Math.pow(Math.random(), 0.7) * 44;
      const x = 64 + Math.cos(angle) * distance;
      const y = 64 + Math.sin(angle) * distance;
      const r = random(8, 22) * (1 - distance / 70);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, `rgba(14, 11, 9, ${random(0.25, 0.45) * (1 - distance / 60)})`);
      gradient.addColorStop(1, 'rgba(14, 11, 9, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }
  });
}
