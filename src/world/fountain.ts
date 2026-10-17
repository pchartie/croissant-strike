import * as THREE from 'three';

// Eau animée d'une fontaine, posée sur la fontaine construite par Blender (bassin et vasque ronds,
// voir map/medina/build.py) : jet qui monte de la vasque et gouttes qui retombent, rideau d'eau qui
// déborde vers le bassin, reflets qui ondulent sur l'eau, écume au pied du rideau. Quelques appels de
// dessin, sans lumière (l'éclairage de la fontaine est précalculé) ; textures dessinées ici.

/** Dimensions de la fontaine (les mêmes que dans map/medina/build.py). */
export interface FountainSpec {
  x: number;
  z: number;
  /** Bassin : rayon de l'eau et hauteur de sa surface. */
  basinRadius: number;
  basinWater: number;
  /** Vasque : rayon et hauteur du bord (l'eau affleure). */
  bowlRadius: number;
  bowlTop: number;
  /** Rayon du rebord extérieur de la vasque, d'où l'eau déborde (par défaut, celui de l'eau). */
  bowlLip?: number;
}

const JET_HEIGHT = 0.6;
const DROPS = 140;
const GRAVITY = 9.8;

function canvasTexture(size: [number, number], draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = size;
  draw(canvas.getContext('2d')!, size[0], size[1]);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Reflets : lignes claires et sinueuses, comme le soleil sur une eau qui bouge. */
function rippleTexture(): THREE.CanvasTexture {
  return canvasTexture([256, 256], (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    for (let i = 0; i < 26; i++) {
      ctx.lineWidth = 1 + Math.random() * 2.5;
      ctx.beginPath();
      const y0 = Math.random() * h;
      for (let x = -10; x <= w + 10; x += 8) {
        const y = y0 + Math.sin(x * 0.05 + i) * 9 + Math.sin(x * 0.13 + i * 2) * 4;
        if (x === -10) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

/** Eau qui coule : traînées verticales claires, plus ou moins transparentes. */
function streakTexture(): THREE.CanvasTexture {
  return canvasTexture([64, 256], (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * w;
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      const a = 0.25 + Math.random() * 0.5;
      gradient.addColorStop(0, `rgba(255,255,255,0)`);
      gradient.addColorStop(Math.random() * 0.5 + 0.2, `rgba(255,255,255,${a})`);
      gradient.addColorStop(1, `rgba(255,255,255,0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(x, 0, 1 + Math.random() * 3, h);
    }
  });
}

/** Écume : anneau blanc irrégulier (la texture couvre le disque, transparente au centre). */
function foamTexture(): THREE.CanvasTexture {
  return canvasTexture([256, 256], (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = w * (0.36 + Math.random() * 0.12);
      ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.35})`;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(angle) * r, h / 2 + Math.sin(angle) * r, 1 + Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Matériau d'eau : texture claire sur fond noir, ajoutée à ce qui est derrière. */
function waterMaterial(map: THREE.Texture, color: number, opacity: number, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side });
}

export class Fountain {
  readonly group = new THREE.Group();
  private readonly ripples: THREE.Texture[] = [];
  private readonly falling: THREE.Texture[] = [];
  private readonly drops: THREE.Points;
  private readonly velocities = new Float32Array(DROPS * 3);
  private readonly foam: THREE.Mesh;
  private time = 0;

  constructor(private readonly spec: FountainSpec) {
    const { x, z, basinRadius, basinWater, bowlRadius, bowlTop } = spec;
    this.group.position.set(x, 0, z);

    // Reflets sur le bassin et la vasque : deux couches qui glissent en sens contraires.
    for (const [radius, y] of [[basinRadius, basinWater], [bowlRadius, bowlTop]] as const) {
      for (const [k, speed] of [[0, 1], [1, -0.7]] as const) {
        const map = rippleTexture();
        map.repeat.setScalar(radius * 0.9);
        map.rotation = k * 1.1;
        this.ripples.push(map);
        (map.userData as { speed: number }).speed = speed;
        const surface = new THREE.Mesh(new THREE.CircleGeometry(radius, 40, Math.PI / 40), waterMaterial(map, 0xb8e0e6, 0.32));
        surface.rotation.x = -Math.PI / 2;
        surface.position.y = y + 0.004 + k * 0.002;
        this.group.add(surface);
      }
    }

    // Jet qui monte du centre de la vasque.
    const jetMap = streakTexture();
    jetMap.repeat.set(1, 0.6);
    this.falling.push(jetMap);
    (jetMap.userData as { speed: number }).speed = -2.2;
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, JET_HEIGHT, 8, 1, true), waterMaterial(jetMap, 0xe6f6ff, 0.85, THREE.DoubleSide));
    jet.position.y = bowlTop + JET_HEIGHT / 2;
    this.group.add(jet);

    // Rideau d'eau qui déborde de la vasque et s'évase en tombant dans le bassin.
    const curtainMap = streakTexture();
    curtainMap.repeat.set(10, 0.8);
    this.falling.push(curtainMap);
    (curtainMap.userData as { speed: number }).speed = 1.6;
    const drop = bowlTop - basinWater;
    const lip = spec.bowlLip ?? bowlRadius;
    const curtain = new THREE.Mesh(
      new THREE.CylinderGeometry(lip + 0.02, lip + 0.14, drop, 40, 1, true),
      waterMaterial(curtainMap, 0xcfeaf0, 0.45, THREE.DoubleSide),
    );
    curtain.position.y = basinWater + drop / 2;
    this.group.add(curtain);

    // Écume au pied du rideau.
    this.foam = new THREE.Mesh(new THREE.PlaneGeometry((lip + 0.45) * 2, (lip + 0.45) * 2), waterMaterial(foamTexture(), 0xffffff, 0.5));
    this.foam.rotation.x = -Math.PI / 2;
    this.foam.position.y = basinWater + 0.01;
    this.group.add(this.foam);

    // Gouttes qui jaillissent du haut du jet et retombent dans la vasque.
    const positions = new Float32Array(DROPS * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.drops = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0xdff2ff, size: 0.035, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.drops.frustumCulled = false;
    for (let i = 0; i < DROPS; i++) this.respawn(i, Math.random());
    this.group.add(this.drops);
  }

  /** Relance une goutte au sommet du jet ; `age` (0 à 1) la place déjà en vol au départ. */
  private respawn(i: number, age = 0): void {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.35 + Math.random() * 0.45;
    const v = this.velocities;
    v[i * 3] = Math.cos(angle) * speed;
    v[i * 3 + 1] = 0.6 + Math.random() * 0.9;
    v[i * 3 + 2] = Math.sin(angle) * speed;
    const p = this.drops.geometry.attributes.position.array as Float32Array;
    const t = age * 0.5;
    p[i * 3] = v[i * 3] * t;
    p[i * 3 + 1] = this.spec.bowlTop + JET_HEIGHT + v[i * 3 + 1] * t - (GRAVITY / 2) * t * t;
    p[i * 3 + 2] = v[i * 3 + 2] * t;
    v[i * 3 + 1] -= GRAVITY * t;
  }

  update(dt: number): void {
    this.time += dt;
    for (const map of this.ripples) {
      const speed = (map.userData as { speed: number }).speed;
      map.offset.set(Math.sin(this.time * 0.3 * speed) * 0.15 + this.time * 0.05 * speed, this.time * 0.08 * speed);
    }
    for (const map of this.falling) map.offset.y += dt * (map.userData as { speed: number }).speed;
    this.foam.rotation.z += dt * 0.15;

    const p = this.drops.geometry.attributes.position.array as Float32Array;
    const v = this.velocities;
    for (let i = 0; i < DROPS; i++) {
      v[i * 3 + 1] -= GRAVITY * dt;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < this.spec.bowlTop) this.respawn(i);
    }
    this.drops.geometry.attributes.position.needsUpdate = true;
  }
}
