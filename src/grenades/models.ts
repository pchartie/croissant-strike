import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRENADES, type GrenadeType } from './definitions';

// Grenades (environ 12 cm de haut), modélisées ici pièce par pièce : corps, détonateur, cuillère,
// anneau et goupille, marquages. Les pièces d'une même matière sont fusionnées une fois pour toutes
// par type : une grenade coûte 2 à 4 appels de dessin, quel que soit son nombre de détails.

/** Matières : peinture (corps), métal (détonateur, cuillère), tissu, verre et liquide (molotov). */
type Finish = 'paint' | 'metal' | 'cloth' | 'liquid' | 'glass';

const MATERIALS: Record<Finish, THREE.MeshStandardMaterial> = {
  paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.25 }),
  // Peu métallique : sans reflets d'environnement, un vrai métal paraît noir.
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 }),
  cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
  // Le liquide est dessiné avant le verre qui l'entoure.
  liquid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, transparent: true, opacity: 0.85 }),
  glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.4, depthWrite: false }),
};
const RENDER_ORDER: Partial<Record<Finish, number>> = { liquid: 1, glass: 2 };

const STEEL = 0xa9adb1;
const DARK_STEEL = 0x6a6e72;
const MARKING = 0x23241f;
const HOLE = 0x18191b;

/** Une pièce : sa forme, sa couleur et sa matière, déjà placée. */
interface Part {
  geometry: THREE.BufferGeometry;
  color: number;
  finish: Finish;
}

/** Place une forme : position, rotation (radians) et échelle. */
function place(geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale?: [number, number, number]): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(...(scale ?? [1, 1, 1])),
  );
  return geometry.applyMatrix4(matrix);
}

/** Forme de révolution autour de l'axe vertical, d'après un profil [rayon, hauteur]. */
function lathe(profile: [number, number][], segments = 24): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

/** Anneau couché (dans le plan horizontal) : joints, bandes de marquage. */
function ring(radius: number, tube: number, y: number): THREE.BufferGeometry {
  return place(new THREE.TorusGeometry(radius, tube, 6, 32), 0, y, 0, Math.PI / 2);
}

/** Petits éléments répartis autour du corps, tournés vers l'extérieur (trous, rainures). */
function around(count: number, radius: number, y: number, make: () => THREE.BufferGeometry, offset = 0): THREE.BufferGeometry[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = offset + (i / count) * Math.PI * 2;
    return place(make(), Math.cos(angle) * radius, y, Math.sin(angle) * radius, 0, -angle, 0);
  });
}

/** Bande (lamelle) qui suit une suite de points [x, y] dans le plan vertical (cuillère, chiffon). */
function strip(points: [number, number][], width: number, thickness: number, z = 0): THREE.BufferGeometry[] {
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const length = Math.hypot(x2 - x1, y2 - y1);
    // Un peu plus long que l'écart, pour que les morceaux se chevauchent aux coudes.
    const piece = new THREE.BoxGeometry(length + thickness, thickness, width);
    pieces.push(place(piece, (x1 + x2) / 2, (y1 + y2) / 2, z, 0, 0, Math.atan2(y2 - y1, x2 - x1)));
  }
  return pieces;
}

/**
 * Détonateur commun aux trois grenades à cuillère : col, tête, bouchon, logement du percuteur,
 * cuillère qui épouse le corps (`spoon`, de son sommet vers le bas), anneau et goupille.
 */
function fuze(base: number, spoon: [number, number][]): Part[] {
  const metal = (geometry: THREE.BufferGeometry, color = STEEL): Part => ({ geometry, color, finish: 'metal' });
  const top = base + 0.03;
  return [
    metal(place(new THREE.CylinderGeometry(0.014, 0.015, 0.01, 16), 0, base + 0.005), DARK_STEEL),
    metal(place(new THREE.CylinderGeometry(0.012, 0.013, 0.016, 16), 0, base + 0.018)),
    metal(place(new THREE.CylinderGeometry(0.009, 0.011, 0.004, 16), 0, base + 0.028)),
    // Logement du percuteur, sous la cuillère.
    metal(place(new THREE.BoxGeometry(0.012, 0.016, 0.014), 0.01, base + 0.018)),
    // Rivet de la charnière de la cuillère.
    metal(place(new THREE.CylinderGeometry(0.0025, 0.0025, 0.018, 8), 0.016, base + 0.024, 0, Math.PI / 2), DARK_STEEL),
    // Cuillère : part du sommet et descend le long du corps.
    ...strip([[0.004, top], ...spoon], 0.011, 0.0018).map((geometry) => metal(geometry)),
    // Goupille (à travers le détonateur) et son anneau, côté gauche.
    metal(place(new THREE.CylinderGeometry(0.0012, 0.0012, 0.03, 6), 0, base + 0.018, -0.008, Math.PI / 2), DARK_STEEL),
    metal(place(new THREE.TorusGeometry(0.0105, 0.0013, 6, 20), -0.006, base + 0.014, -0.031, 0.25, 0.5, 0)),
  ];
}

/** Grenade HE (M67) : œuf vert olive, joint au milieu, bande jaune, cuillère courbe. */
function he(color: number): Part[] {
  const paint = (geometry: THREE.BufferGeometry, tint = color): Part => ({ geometry, color: tint, finish: 'paint' });
  const body = lathe([
    [0, -0.042],
    [0.012, -0.041],
    [0.024, -0.036],
    [0.033, -0.026],
    [0.039, -0.012],
    [0.04, 0],
    [0.039, 0.012],
    [0.034, 0.025],
    [0.026, 0.035],
    [0.017, 0.041],
    [0.015, 0.042],
  ]);
  return [
    paint(body),
    // Joint de soudure des deux coques, et bande jaune d'explosif.
    paint(ring(0.0402, 0.0011, 0), 0x3b4727),
    paint(ring(0.0315, 0.0009, 0.027), 0xd9b43a),
    // Inscriptions jaunes au pochoir, sur le devant.
    ...around(3, 0.0392, 0.012, () => new THREE.BoxGeometry(0.0012, 0.0035, 0.009), Math.PI - 0.32).map((geometry) => paint(geometry, 0xd9b43a)),
    ...around(2, 0.0396, 0.004, () => new THREE.BoxGeometry(0.0012, 0.0035, 0.012), Math.PI - 0.22).map((geometry) => paint(geometry, 0xd9b43a)),
    // Fond : petit bouchon de remplissage.
    paint(place(new THREE.CylinderGeometry(0.007, 0.008, 0.003, 12), 0, -0.042), 0x3b4727),
    ...fuze(0.04, [
      [0.02, 0.07],
      [0.027, 0.064],
      [0.032, 0.053],
      [0.039, 0.038],
      [0.0435, 0.02],
      [0.0445, 0.002],
      [0.0425, -0.016],
      [0.0385, -0.026],
    ]),
  ];
}

/** Corps cylindrique arrondi aux bords (flash, fumigène). */
function canister(radius: number, half: number): THREE.LatheGeometry {
  const r = radius;
  return lathe([
    [0, -half],
    [r - 0.004, -half],
    [r - 0.001, -half + 0.0015],
    [r, -half + 0.004],
    [r, half - 0.004],
    [r - 0.001, half - 0.0015],
    [r - 0.004, half],
    [0, half],
  ]);
}

/** Flash (M84) : cylindre gris, une rangée d'évents ronds, bande claire, cerclages. */
function flash(color: number): Part[] {
  const paint = (geometry: THREE.BufferGeometry, tint = color): Part => ({ geometry, color: tint, finish: 'paint' });
  const port = () => new THREE.CylinderGeometry(0.0048, 0.0048, 0.003, 12).rotateZ(Math.PI / 2);
  return [
    paint(canister(0.03, 0.05)),
    // Évents ronds par où sort l'éclair, une rangée sous le détonateur, dans une bague plus sombre.
    paint(place(new THREE.CylinderGeometry(0.0304, 0.0304, 0.016, 28, 1, true), 0, 0.026), 0x858b91),
    ...around(8, 0.0298, 0.026, port).map((geometry) => paint(geometry, HOLE)),
    // Bande claire de marquage et cerclages.
    paint(place(new THREE.CylinderGeometry(0.0305, 0.0305, 0.012, 28, 1, true), 0, -0.032), 0xd8d3c2),
    ...around(4, 0.0308, -0.032, () => new THREE.BoxGeometry(0.0012, 0.004, 0.011), Math.PI - 0.5).map((geometry) => paint(geometry, MARKING)),
    paint(ring(0.0302, 0.0014, -0.044), 0x6f7478),
    paint(ring(0.0302, 0.0014, 0.044), 0x6f7478),
    ...fuze(0.05, [
      [0.02, 0.08],
      [0.027, 0.074],
      [0.032, 0.064],
      [0.0335, 0.05],
      [0.0335, 0.02],
      [0.0335, -0.012],
      [0.032, -0.024],
    ]),
  ];
}

/** Fumigène (M18) : cylindre bleu-gris, quatre évents sur le dessus, bande jaune marquée. */
function smoke(color: number): Part[] {
  const paint = (geometry: THREE.BufferGeometry, tint = color): Part => ({ geometry, color: tint, finish: 'paint' });
  const vent = () => new THREE.CylinderGeometry(0.0042, 0.0042, 0.002, 10);
  const mark = () => new THREE.BoxGeometry(0.0015, 0.004, 0.012);
  return [
    paint(canister(0.031, 0.05)),
    // Évents du dessus, autour du détonateur.
    ...around(4, 0.022, 0.0502, vent, Math.PI / 4).map((geometry) => paint(geometry, HOLE)),
    // Bande jaune avec ses inscriptions, cerclages, fond sombre.
    paint(place(new THREE.CylinderGeometry(0.0313, 0.0313, 0.018, 28, 1, true), 0, 0.012), 0xc9a227),
    ...around(5, 0.0316, 0.012, mark, -Math.PI / 2 - 0.5).map((geometry) => paint(geometry, MARKING)),
    paint(ring(0.0312, 0.0014, -0.045), 0x51666d),
    paint(ring(0.0312, 0.0014, 0.045), 0x51666d),
    paint(place(new THREE.CylinderGeometry(0.028, 0.028, 0.002, 24), 0, -0.0505), 0x2f3a3e),
    ...fuze(0.05, [
      [0.02, 0.08],
      [0.027, 0.074],
      [0.032, 0.064],
      [0.0345, 0.05],
      [0.0345, 0.02],
      [0.0345, -0.012],
      [0.033, -0.024],
    ]),
  ];
}

/**
 * Molotov : bouteille de verre vert, à moitié pleine d'essence ambrée, étiquette, chiffon enfoncé
 * dans le goulot et noué, qui pend sur le côté (bout noirci).
 */
function molotov(): Part[] {
  const bottle: [number, number][] = [
    [0, -0.07],
    [0.028, -0.07],
    [0.032, -0.067],
    [0.034, -0.061],
    [0.034, 0.018],
    [0.032, 0.03],
    [0.025, 0.044],
    [0.016, 0.056],
    [0.0118, 0.066],
    [0.0115, 0.088],
    [0.0135, 0.09],
    [0.0135, 0.096],
    [0.0115, 0.098],
  ];
  const cloth = (geometry: THREE.BufferGeometry, tint = 0xcdc3aa): Part => ({ geometry, color: tint, finish: 'cloth' });
  // Pan de chiffon qui tombe du nœud le long du goulot jusqu'à l'épaule ; le bout est noirci.
  const flap = strip(
    [
      [0.004, 0.113],
      [0.015, 0.115],
      [0.021, 0.106],
      [0.02, 0.092],
      [0.024, 0.076],
      [0.031, 0.062],
      [0.037, 0.048],
      [0.039, 0.036],
    ],
    0.017,
    0.0028,
    0.003,
  );
  const tail = strip(
    [
      [-0.004, 0.112],
      [-0.013, 0.11],
      [-0.017, 0.1],
      [-0.016, 0.09],
    ],
    0.012,
    0.0025,
    -0.004,
  );
  return [
    { geometry: lathe(bottle, 28), color: 0x7f9c6a, finish: 'glass' },
    // Essence : jusqu'aux deux tiers, surface plate.
    {
      geometry: lathe([
        [0, -0.0675],
        [0.0305, -0.0675],
        [0.0315, -0.06],
        [0.0315, 0.006],
        [0, 0.006],
      ]),
      color: 0xc0701f,
      finish: 'liquid',
    },
    // Étiquette en papier, sur le devant, avec une bande rouge.
    { geometry: place(new THREE.CylinderGeometry(0.0345, 0.0345, 0.036, 24, 1, true, -1.2, 2.4), 0, -0.022), color: 0xdccca0, finish: 'cloth' },
    { geometry: place(new THREE.CylinderGeometry(0.0347, 0.0347, 0.006, 24, 1, true, -1.2, 2.4), 0, -0.012), color: 0xa3312a, finish: 'cloth' },
    // Chiffon : bourré dans le goulot, qui dépasse, noué d'une ficelle, et qui pend.
    cloth(place(new THREE.CylinderGeometry(0.0095, 0.0105, 0.04, 10), 0, 0.094)),
    cloth(place(new THREE.SphereGeometry(0.0125, 10, 8), 0.002, 0.113, 0, 0.3, 0, 0.2, [1.1, 0.75, 1])),
    cloth(place(new THREE.SphereGeometry(0.007, 8, 6), -0.006, 0.12, 0.004, 0, 0, 0, [1, 0.7, 1.2]), 0xbfb59b),
    ...flap.map((geometry, i) => cloth(geometry, i >= flap.length - 2 ? 0x4a3f33 : i % 2 ? 0xc4b99e : 0xcdc3aa)),
    ...tail.map((geometry) => cloth(geometry, 0xc4b99e)),
    cloth(place(new THREE.TorusGeometry(0.0125, 0.0014, 6, 18), 0, 0.083, 0, Math.PI / 2), 0x5b4a36),
  ];
}

/** Pièces fusionnées par matière, une fois par type (partagées par toutes les grenades). */
const MERGED = new Map<GrenadeType, Map<Finish, THREE.BufferGeometry>>();

function merged(type: GrenadeType): Map<Finish, THREE.BufferGeometry> {
  const cached = MERGED.get(type);
  if (cached) return cached;
  const color = GRENADES[type].color;
  const parts = type === 'he' ? he(color) : type === 'flash' ? flash(color) : type === 'smoke' ? smoke(color) : molotov();
  const byFinish = new Map<Finish, THREE.BufferGeometry[]>();
  const tint = new THREE.Color();
  for (const { geometry, color: hex, finish } of parts) {
    // Mêmes attributs partout pour pouvoir fusionner : position, normale et couleur.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute('uv');
    tint.setHex(hex, THREE.SRGBColorSpace);
    const colors = new Float32Array(flat.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    byFinish.set(finish, [...(byFinish.get(finish) ?? []), flat]);
  }
  const result = new Map([...byFinish].map(([finish, geometries]) => [finish, mergeGeometries(geometries)!]));
  MERGED.set(type, result);
  return result;
}

export function buildGrenadeModel(type: GrenadeType): THREE.Group {
  const group = new THREE.Group();
  for (const [finish, geometry] of merged(type)) {
    const mesh = new THREE.Mesh(geometry, MATERIALS[finish]);
    mesh.renderOrder = RENDER_ORDER[finish] ?? 0;
    group.add(mesh);
  }
  return group;
}
