import * as THREE from 'three';

/** Calibre de la douille éjectée : 5,56 (M4A1), 9 mm (MP5, pistolet) ou cartouche de chevrotine (Nova). */
export type CasingKind = '556' | '9mm' | 'buckshot';

const GRAVITY = 9.8;
/** Douilles au sol en même temps : les plus anciennes disparaissent. */
const MAX_CASINGS = 60;
/** Durée de vie au sol, puis la douille rétrécit et disparaît. */
const LIFETIME = 10;
const FADE = 0.6;
/** Rebond sur le sol : vitesse verticale gardée, et freinage horizontal. */
const BOUNCE = 0.35;
const FRICTION = 0.55;
/** En dessous de cette vitesse verticale au contact du sol, la douille s'arrête. */
const REST_SPEED = 0.6;
/** Douilles un peu grossies, comme dans la plupart des FPS : à taille réelle, elles se perdent dans le sable. */
const SCALE = 1.6;
/** Laiton des douilles, plastique rouge des cartouches de chevrotine. */
export const CASING_COLORS = { brass: 0xd4a843, plastic: 0xb3281e };

/** Douille de secours (sans le pack d'armes) : un petit cylindre laiton, en mètres. */
const FALLBACK_SIZE: Record<CasingKind, [radius: number, length: number]> = {
  '556': [0.0048, 0.045],
  '9mm': [0.005, 0.022],
  buckshot: [0.009, 0.06],
};

interface Casing {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  /** Hauteur du sol sous la douille (trouvée une fois, au moment de l'éjection). */
  floor: number;
  /** Demi-épaisseur : la douille repose sur le sol, pas à moitié dedans. */
  radius: number;
  age: number;
  resting: boolean;
  kind: CasingKind;
}

export interface CasingHooks {
  /** Hauteur du sol sous un point. */
  floorBelow(position: THREE.Vector3): number;
}

/** Douilles éjectées à chaque tir : elles volent, rebondissent (sans bruit) et restent un moment au sol. */
export class Casings {
  private readonly casings: Casing[] = [];
  private readonly models: Record<CasingKind, THREE.Object3D>;
  private readonly euler = new THREE.Euler();
  private readonly turn = new THREE.Quaternion();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hooks: CasingHooks,
  ) {
    const brass = new THREE.MeshStandardMaterial({ color: CASING_COLORS.brass, metalness: 0.2, roughness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: CASING_COLORS.plastic, roughness: 0.6 });
    this.models = {
      '556': fallbackModel(FALLBACK_SIZE['556'], brass),
      '9mm': fallbackModel(FALLBACK_SIZE['9mm'], brass),
      buckshot: fallbackModel(FALLBACK_SIZE.buckshot, red),
    };
  }

  /** Modèles du pack d'armes, quand ils sont chargés (sinon les cylindres de secours restent). */
  setModels(models: Record<CasingKind, THREE.Object3D>): void {
    Object.assign(this.models, models);
  }

  /** Éjecte une douille depuis `position`, lancée à `velocity` (m/s). */
  eject(kind: CasingKind, position: THREE.Vector3, velocity: THREE.Vector3): void {
    if (this.casings.length >= MAX_CASINGS) this.remove(this.casings[0]);
    const mesh = this.models[kind].clone();
    mesh.position.copy(position);
    mesh.scale.setScalar(SCALE);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    this.scene.add(mesh);
    this.casings.push({
      mesh,
      velocity: velocity.clone(),
      spin: new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30),
      floor: this.hooks.floorBelow(position),
      radius: FALLBACK_SIZE[kind][0] * SCALE,
      age: 0,
      resting: false,
      kind,
    });
  }

  update(dt: number): void {
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const casing = this.casings[i];
      casing.age += dt;
      if (casing.age > LIFETIME) {
        const left = 1 - (casing.age - LIFETIME) / FADE;
        if (left <= 0) {
          this.remove(casing);
          continue;
        }
        casing.mesh.scale.setScalar(left * SCALE);
      }
      if (casing.resting) continue;

      const { mesh, velocity, spin } = casing;
      velocity.y -= GRAVITY * dt;
      mesh.position.addScaledVector(velocity, dt);
      this.euler.set(spin.x * dt, spin.y * dt, spin.z * dt);
      mesh.quaternion.multiply(this.turn.setFromEuler(this.euler));

      const ground = casing.floor + casing.radius;
      if (mesh.position.y > ground || velocity.y > 0) continue;
      mesh.position.y = ground;
      const impact = -velocity.y;
      if (impact < REST_SPEED) {
        // Couchée sur le flanc (son axe x reste à l'horizontale), tournée au hasard.
        casing.resting = true;
        mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 0, 'YXZ');
        continue;
      }
      velocity.y = impact * BOUNCE;
      velocity.x *= FRICTION;
      velocity.z *= FRICTION;
      spin.multiplyScalar(FRICTION);
    }
  }

  /** Retire toutes les douilles (nouvelle manche). */
  clear(): void {
    for (const casing of this.casings) this.scene.remove(casing.mesh);
    this.casings.length = 0;
  }

  private remove(casing: Casing): void {
    this.scene.remove(casing.mesh);
    this.casings.splice(this.casings.indexOf(casing), 1);
  }
}

/** Cylindre couché le long de x, comme les douilles du pack. */
function fallbackModel([radius, length]: [number, number], material: THREE.Material): THREE.Object3D {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
  geometry.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}
