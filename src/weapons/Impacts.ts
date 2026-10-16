import * as THREE from 'three';
import { surfaceOf, type Surface } from '../world/surfaces';

const MAX_DECALS = 120;
const GRAVITY = 9.8;
const HIDDEN_Y = -1000;
/** Éclats du pack (Wallhit_Debris) : nombre maximal par forme, distance au-delà de laquelle on n'en lance pas. */
const DEBRIS_MAX = 48;
const DEBRIS_RANGE = 25;
/** Couleur des éclats selon la matière touchée (pas d'éclats sur le métal ni le sable). */
const DEBRIS_COLORS: Partial<Record<Surface, number>> = { stone: 0xa8977a, plaster: 0xb9a184, wood: 0x6b4526 };

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
  private debris: Debris | null = null;
  private readonly normal = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();
  private static readonly FORWARD = new THREE.Vector3(0, 0, 1);

  constructor(
    private readonly scene: THREE.Scene,
    /** Hauteur du sol sous un point, et position de la caméra (les éclats ne sont lancés que près d'elle). */
    private readonly world: { floorBelow: (point: THREE.Vector3) => number; viewer: () => THREE.Vector3 },
  ) {
    this.dust = new Particles(scene, 400, 0xbcae92, 0.035);
    this.sand = new Particles(scene, 300, 0xc9ad7f, 0.045);
    this.chips = new Particles(scene, 200, 0x6b4526, 0.03);
    this.sparks = new Particles(scene, 200, 0xffc46b, 0.03, true);
    // Gouttes fines (2,5 cm), nombreuses : une giclée, pas des confettis.
    this.blood = new Particles(scene, 600, 0x7d0d08, 0.025);
  }

  /** Balle dans un mur ou un objet : trou, et éclats selon la matière (renvoyée pour le son). */
  add(hit: THREE.Intersection): Surface {
    const surface = surfaceOf(hit.object);
    if (!hit.face) return surface;
    this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    this.addDecal(hit.point, this.normal);
    this.addDebris(hit.point, this.normal, surface);
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

  /** Éclats en 3D du pack (une fois chargés) : sinon, seulement la poussière. */
  setDebrisModel(source: THREE.Object3D): void {
    this.debris = new Debris(this.scene, source);
  }

  private addDebris(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface): void {
    const color = DEBRIS_COLORS[surface];
    if (!this.debris || color === undefined || point.distanceTo(this.world.viewer()) > DEBRIS_RANGE) return;
    // Sol touché : il est là ; mur : on le cherche juste dessous (un seul rayon par impact).
    const floor = normal.y > 0.7 ? point.y : this.world.floorBelow(this.probe.copy(point).addScaledVector(normal, 0.05));
    this.debris.burst(point, normal, color, surface === 'wood' ? 3 : 4, floor);
  }

  /** Balle dans un bot : giclée de sang dans le sens du tir. */
  addBlood(point: THREE.Vector3, direction: THREE.Vector3, amount = 10): void {
    this.blood.burst(point, direction, Math.round(amount * 1.8), 0.5, 2.2, 0.5);
  }

  update(dt: number): void {
    for (const particles of [this.dust, this.sand, this.chips, this.sparks, this.blood]) particles.update(dt);
    this.debris?.update(dt);
  }

  private addDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    let decal = this.decals[this.nextDecal];
    if (!decal) {
      decal = new THREE.Mesh(this.decalGeometry, this.decalMaterial);
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

/**
 * Éclats de mur : trois formes du pack, chacune dessinée en une fois (InstancedMesh), cachées
 * quand aucun éclat ne vole. Ils jaillissent du mur, tournent, rebondissent au sol puis rétrécissent.
 */
class Debris {
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly spin: Float32Array;
  private readonly rotation: THREE.Quaternion[] = [];
  private readonly size: Float32Array;
  private readonly floor: Float32Array;
  private readonly life: Float32Array;
  private next = 0;
  private alive = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly step = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly point = new THREE.Vector3();

  constructor(scene: THREE.Scene, source: THREE.Object3D) {
    const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    source.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const geometry = (child.geometry as THREE.BufferGeometry).clone();
      geometry.center();
      // Ramenés à 1 m de côté : la taille de chaque éclat est donnée à son lancement.
      geometry.computeBoundingBox();
      const extent = geometry.boundingBox!.getSize(new THREE.Vector3());
      const unit = 1 / Math.max(extent.x, extent.y, extent.z);
      geometry.scale(unit, unit, unit);
      const mesh = new THREE.InstancedMesh(geometry, material, DEBRIS_MAX);
      // Tous repliés à zéro au départ (une instance vaut sinon un éclat de 1 m à l'origine).
      for (let i = 0; i < DEBRIS_MAX; i++) mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this.color.set(0xffffff));
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      this.meshes.push(mesh);
    });
    const count = DEBRIS_MAX * this.meshes.length;
    this.position = new Float32Array(count * 3);
    this.velocity = new Float32Array(count * 3);
    this.spin = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.floor = new Float32Array(count);
    this.life = new Float32Array(count);
    for (let i = 0; i < count; i++) this.rotation.push(new THREE.Quaternion());
  }

  burst(point: THREE.Vector3, normal: THREE.Vector3, color: number, count: number, floor: number): void {
    const total = this.life.length;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % total;
      if (this.life[i] <= 0) this.alive++;
      const speed = 1.2 + Math.random() * 2;
      this.position.set([point.x + normal.x * 0.02, point.y + normal.y * 0.02, point.z + normal.z * 0.02], i * 3);
      this.velocity.set(
        [
          (normal.x + (Math.random() - 0.5) * 1.4) * speed,
          (normal.y + (Math.random() - 0.5) * 1.4) * speed + 1.2,
          (normal.z + (Math.random() - 0.5) * 1.4) * speed,
        ],
        i * 3,
      );
      this.spin.set([(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30], i * 3);
      this.rotation[i].random();
      this.size[i] = 0.018 + Math.random() * 0.025;
      this.floor[i] = floor;
      this.life[i] = 0.7 + Math.random() * 0.5;
      // Teinte légèrement variée d'un éclat à l'autre.
      const mesh = this.meshes[i % this.meshes.length];
      mesh.setColorAt(Math.floor(i / this.meshes.length), this.color.set(color).multiplyScalar(0.8 + Math.random() * 0.35));
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    const forms = this.meshes.length;
    for (let i = 0; i < this.life.length; i++) {
      if (this.life[i] <= 0) continue;
      const mesh = this.meshes[i % forms];
      const slot = Math.floor(i / forms);
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive--;
        mesh.setMatrixAt(slot, this.matrix.makeScale(0, 0, 0));
        continue;
      }
      const p = i * 3;
      const v = this.velocity;
      v[p + 1] -= GRAVITY * dt;
      this.position[p] += v[p] * dt;
      this.position[p + 1] += v[p + 1] * dt;
      this.position[p + 2] += v[p + 2] * dt;
      // Rebond amorti sur le sol, puis l'éclat glisse et s'arrête.
      const ground = this.floor[i] + this.size[i] * 0.5;
      if (this.position[p + 1] < ground) {
        this.position[p + 1] = ground;
        v[p + 1] = Math.abs(v[p + 1]) * 0.3;
        v[p] *= 0.5;
        v[p + 2] *= 0.5;
        for (let k = 0; k < 3; k++) this.spin[p + k] *= 0.5;
      }
      const angular = Math.hypot(this.spin[p], this.spin[p + 1], this.spin[p + 2]);
      if (angular > 1e-3) {
        this.axis.set(this.spin[p], this.spin[p + 1], this.spin[p + 2]).divideScalar(angular);
        this.rotation[i].premultiply(this.step.setFromAxisAngle(this.axis, angular * dt));
      }
      // Rétrécit sur ses 0,2 dernières secondes.
      const scale = this.size[i] * Math.min(1, this.life[i] / 0.2);
      this.matrix.compose(this.point.fromArray(this.position, p), this.rotation[i], this.scale.setScalar(scale));
      mesh.setMatrixAt(slot, this.matrix);
    }
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = this.alive > 0;
    }
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
