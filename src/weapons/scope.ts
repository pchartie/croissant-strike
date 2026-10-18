import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Lunette du sniper (le Barrett du pack n'en a pas de modélisée), en centimètres, axe le long de +x,
// oculaire vers -x. Tube avec cloches avant et arrière, tourelles, deux colliers sur le rail, verres.
// Pièces fusionnées par matière, une fois : 2 appels de dessin.

const BODY = 0x26282b;
const RING = 0x1b1c1e;
const TURRET = 0x2f3236;
const LENS = 0x1d3a52;
/** Oculaire : verre presque noir (on le voit de près, juste sous le regard). */
const EYEPIECE = 0x0d1216;

type Finish = 'body' | 'glass';

const MATERIALS: Record<Finish, THREE.MeshStandardMaterial> = {
  // Mat : un métal reflète surtout le ciel bleuté de l'éclairage de l'arme en main.
  body: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.75 }),
  // Objectif : verre bleuté, un peu lumineux pour se voir même à l'ombre.
  glass: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.15, emissive: 0x0a1822 }),
};

/** Profil de la lunette (rayon, position le long de l'axe), de l'oculaire à l'objectif. */
const PROFILE: [number, number][] = [
  [0.01, -17],
  [2.1, -17],
  [2.2, -15.5],
  [2.0, -11],
  [1.6, -9.5],
  [1.5, -8.5],
  [1.5, 5],
  [1.6, 6.5],
  [2.8, 11],
  [2.85, 17],
  [2.6, 17.4],
  [0.01, 17.4],
];

let merged: Map<Finish, THREE.BufferGeometry> | null = null;

function scopeGeometries(): Map<Finish, THREE.BufferGeometry> {
  if (merged) return merged;
  // Le tour est fait autour de y : on couche la lunette le long de x.
  const along = (geometry: THREE.BufferGeometry) => geometry.rotateZ(-Math.PI / 2);
  const tube = along(new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 14));
  const turretTop = new THREE.CylinderGeometry(1.15, 1.15, 2.4, 10).translate(-1, 2.4, 0);
  const turretSide = new THREE.CylinderGeometry(1.15, 1.15, 2.4, 10).rotateX(Math.PI / 2).translate(-1, 0, 2.4);
  const rings = [-6, 3.5].flatMap((x) => [
    new THREE.TorusGeometry(1.75, 0.4, 6, 14).rotateY(Math.PI / 2).translate(x, 0, 0),
    new THREE.BoxGeometry(1.6, 3.2, 2.6).translate(x, -2.6, 0),
  ]);
  // Verres : les disques regardent vers +z, on les tourne vers l'avant (objectif) et l'arrière (oculaire).
  const lenses = [
    new THREE.CircleGeometry(2.45, 14).rotateY(Math.PI / 2).translate(17.45, 0, 0),
    new THREE.CircleGeometry(1.8, 14).rotateY(-Math.PI / 2).translate(-17.05, 0, 0),
  ];
  const parts: [THREE.BufferGeometry, number, Finish][] = [
    [tube, BODY, 'body'],
    [turretTop, TURRET, 'body'],
    [turretSide, TURRET, 'body'],
    ...rings.map((g): [THREE.BufferGeometry, number, Finish] => [g, RING, 'body']),
    [lenses[0], LENS, 'glass'],
    [lenses[1], EYEPIECE, 'body'],
  ];
  const byFinish = new Map<Finish, THREE.BufferGeometry[]>();
  const tint = new THREE.Color();
  for (const [geometry, hex, finish] of parts) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute('uv');
    tint.setHex(hex, THREE.SRGBColorSpace);
    const colors = new Float32Array(flat.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    byFinish.set(finish, [...(byFinish.get(finish) ?? []), flat]);
  }
  merged = new Map([...byFinish].map(([finish, geometries]) => [finish, mergeGeometries(geometries)!]));
  return merged;
}

/** Lunette prête à poser sur le rail (géométries partagées). Centre du tube à l'origine. */
export function buildScope(): THREE.Group {
  const root = new THREE.Group();
  for (const [finish, geometry] of scopeGeometries()) {
    const mesh = new THREE.Mesh(geometry, MATERIALS[finish]);
    mesh.frustumCulled = false;
    root.add(mesh);
  }
  return root;
}
