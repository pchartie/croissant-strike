import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Couteau de combat (en mètres), modélisé pièce par pièce : lame à contre-tranchant avec un vrai
// biseau affûté, gouttière et dents sur le dos, garde, manche ovale cranté, pommeau à anneau.
// Repère : centré sur le manche, manche et lame vers +y, tranchant vers +x, plat de la lame face à z.
// Pièces fusionnées par matière, une fois : 3 appels de dessin.

/** Épaisseur de la lame au dos. */
const THICKNESS = 0.0036;
/** Largeur du biseau du tranchant. */
const BEVEL = 0.0055;
/** Base de la lame (au-dessus de la garde). */
const BLADE_BASE = 0.062;

const STEEL = 0xc5cad0;
const EDGE = 0xeef1f4;
const FULLER = 0x878d94;
const GUARD = 0x3c3f44;
const RUBBER = 0x25272a;
const RUBBER_RIB = 0x34373b;

type Finish = 'steel' | 'dark' | 'rubber';

const MATERIALS: Record<Finish, THREE.MeshStandardMaterial> = {
  // Peu métalliques : sans reflets d'environnement, un vrai métal paraît noir.
  steel: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.28 }),
  dark: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.5 }),
  rubber: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.9 }),
};

/** Tranchant, du talon à la pointe : [x, y] (le dos de la lame est à x = -0.012). */
function edgeCurve(): THREE.Vector2[] {
  const curve = new THREE.CubicBezierCurve(
    new THREE.Vector2(0.0145, 0),
    new THREE.Vector2(0.0165, 0.07),
    new THREE.Vector2(0.015, 0.13),
    new THREE.Vector2(-0.004, 0.178),
  );
  return curve.getPoints(24);
}

/** Dos de la lame, de la pointe au talon : contre-tranchant puis dos droit. */
function spineCurve(): THREE.Vector2[] {
  const clip = new THREE.QuadraticBezierCurve(new THREE.Vector2(-0.004, 0.178), new THREE.Vector2(-0.009, 0.15), new THREE.Vector2(-0.012, 0.122));
  return [...clip.getPoints(8), new THREE.Vector2(-0.012, 0)];
}

/** Ligne du biseau : le tranchant décalé vers l'intérieur de la lame. */
function bevelLine(edge: THREE.Vector2[]): THREE.Vector2[] {
  return edge.map((point, i) => {
    const before = edge[Math.max(0, i - 1)];
    const after = edge[Math.min(edge.length - 1, i + 1)];
    const tangent = after.clone().sub(before).normalize();
    // Normale vers le dos (gauche de la tangente qui monte), réduite vers la pointe.
    const inward = new THREE.Vector2(-tangent.y, tangent.x);
    const width = BEVEL * (1 - 0.65 * (i / (edge.length - 1)) ** 2);
    return point.clone().addScaledVector(inward, width);
  });
}

/** Plat de la lame : du dos à la ligne du biseau, épaisseur pleine. */
function bladeFlat(bevel: THREE.Vector2[], spine: THREE.Vector2[]): THREE.BufferGeometry {
  const shape = new THREE.Shape([...bevel, ...spine]);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: THICKNESS, bevelEnabled: false, curveSegments: 1 });
  return geometry.translate(0, 0, -THICKNESS / 2);
}

/** Biseau : deux faces qui se rejoignent en arête vive sur le tranchant. */
function bladeEdge(edge: THREE.Vector2[], bevel: THREE.Vector2[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const half = THICKNESS / 2;
  for (let i = 0; i < edge.length - 1; i++) {
    for (const side of [1, -1]) {
      const b0 = [bevel[i].x, bevel[i].y, side * half];
      const b1 = [bevel[i + 1].x, bevel[i + 1].y, side * half];
      const e0 = [edge[i].x, edge[i].y, 0];
      const e1 = [edge[i + 1].x, edge[i + 1].y, 0];
      // Sens des triangles selon la face, pour que les normales pointent vers l'extérieur.
      if (side > 0) positions.push(...b0, ...e0, ...e1, ...b0, ...e1, ...b1);
      else positions.push(...b0, ...e1, ...e0, ...b0, ...b1, ...e1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Gouttière : sillon plus sombre le long du dos, sur les deux faces. */
function fuller(): THREE.BufferGeometry[] {
  const shape = new THREE.Shape();
  shape.moveTo(-0.0075, 0.012);
  shape.lineTo(-0.0035, 0.012);
  shape.lineTo(-0.0035, 0.1);
  shape.quadraticCurveTo(-0.0055, 0.112, -0.0075, 0.1);
  shape.closePath();
  return [1, -1].map((side) => {
    const geometry = new THREE.ShapeGeometry(shape, 4).translate(0, 0, THICKNESS / 2 + 0.0002);
    return side > 0 ? geometry : mirrorZ(geometry);
  });
}

/** Copie d'une face de l'autre côté de la lame (z opposé), triangles retournés pour rester visibles. */
function mirrorZ(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const mirrored = geometry.clone().scale(1, 1, -1);
  const index = mirrored.index!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  mirrored.computeVertexNormals();
  return mirrored;
}

/** Dents de scie sur le dos, près de la garde. */
function serrations(): THREE.BufferGeometry[] {
  const teeth: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const tooth = new THREE.Shape();
    const y = 0.008 + i * 0.0058;
    tooth.moveTo(-0.0118, y);
    tooth.lineTo(-0.0152, y + 0.0029);
    tooth.lineTo(-0.0118, y + 0.0058);
    tooth.closePath();
    const geometry = new THREE.ExtrudeGeometry(tooth, { depth: THICKNESS * 0.7, bevelEnabled: false });
    teeth.push(geometry.translate(0, 0, -THICKNESS * 0.35));
  }
  return teeth;
}

/** Manche ovale, crans pour les doigts côté tranchant, nervures. */
function handle(): THREE.BufferGeometry[] {
  // Profil le long du manche (de bas en haut) : renflements et creux des doigts.
  const profile: [number, number][] = [
    [0.0001, -0.052],
    [0.0115, -0.052],
    [0.0135, -0.044],
    [0.0128, -0.03],
    [0.0142, -0.018],
    [0.0125, -0.006],
    [0.0142, 0.006],
    [0.0125, 0.018],
    [0.0142, 0.03],
    [0.0128, 0.042],
    [0.0118, 0.054],
    [0.0001, 0.054],
  ];
  const grip = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    20,
  ).scale(1, 1, 0.74);
  const ribs = [-0.036, -0.024, -0.012, 0, 0.012, 0.024, 0.036].map((y) =>
    new THREE.TorusGeometry(0.0128, 0.0009, 4, 20).rotateX(Math.PI / 2).scale(1.04, 1, 0.78).translate(0, y + 0.006, 0),
  );
  return [grip, ...ribs];
}

/** Garde : barre aplatie, arrondie aux bouts, un peu plus longue côté tranchant. */
function guard(): THREE.BufferGeometry[] {
  const bar = new THREE.CapsuleGeometry(0.0048, 0.04, 4, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.75).translate(0.002, 0.058, 0);
  const collar = new THREE.CylinderGeometry(0.0125, 0.0135, 0.006, 16).scale(1, 1, 0.74).translate(0, 0.055, 0);
  return [bar, collar];
}

/** Pommeau en acier et son anneau de dragonne. */
function pommel(): THREE.BufferGeometry[] {
  const cap = new THREE.CylinderGeometry(0.0118, 0.0105, 0.012, 16).scale(1, 1, 0.74).translate(0, -0.058, 0);
  const ring = new THREE.TorusGeometry(0.0055, 0.0013, 6, 14).translate(0, -0.068, 0);
  return [cap, ring];
}

let merged: Map<Finish, THREE.BufferGeometry> | null = null;

function knifeGeometries(): Map<Finish, THREE.BufferGeometry> {
  if (merged) return merged;
  const edge = edgeCurve();
  const bevel = bevelLine(edge);
  const blade = (geometry: THREE.BufferGeometry) => geometry.translate(0, BLADE_BASE, 0);
  const parts: [THREE.BufferGeometry, number, Finish][] = [
    [blade(bladeFlat(bevel, spineCurve())), STEEL, 'steel'],
    [blade(bladeEdge(edge, bevel)), EDGE, 'steel'],
    ...fuller().map((g): [THREE.BufferGeometry, number, Finish] => [blade(g), FULLER, 'steel']),
    ...serrations().map((g): [THREE.BufferGeometry, number, Finish] => [blade(g), STEEL, 'steel']),
    ...guard().map((g): [THREE.BufferGeometry, number, Finish] => [g, GUARD, 'dark']),
    ...pommel().map((g): [THREE.BufferGeometry, number, Finish] => [g, GUARD, 'dark']),
    ...handle().map((g, i): [THREE.BufferGeometry, number, Finish] => [g, i === 0 ? RUBBER : RUBBER_RIB, 'rubber']),
  ];
  const byFinish = new Map<Finish, THREE.BufferGeometry[]>();
  const tint = new THREE.Color();
  for (const [geometry, hex, finish] of parts) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute('uv');
    if (!flat.attributes.normal) flat.computeVertexNormals();
    tint.setHex(hex, THREE.SRGBColorSpace);
    const colors = new Float32Array(flat.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    byFinish.set(finish, [...(byFinish.get(finish) ?? []), flat]);
  }
  merged = new Map([...byFinish].map(([finish, geometries]) => [finish, mergeGeometries(geometries)!]));
  return merged;
}

/** Couteau prêt à placer (géométries partagées entre tous les couteaux). */
export function buildKnife(): THREE.Group {
  const root = new THREE.Group();
  for (const [finish, geometry] of knifeGeometries()) root.add(new THREE.Mesh(geometry, MATERIALS[finish]));
  return root;
}
