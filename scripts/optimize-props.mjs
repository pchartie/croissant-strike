// Télécharge les objets de la carte sur Poly Haven (glTF 1k, CC0) et les optimise pour le navigateur :
// maillage simplifié, textures réduites en WebP, géométrie compressée (Meshopt). Un .glb par objet.
//
// Utilisation : npm run optimize-props
// Résultat    : public/assets/props/

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, quantize, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.props-src');
const OUT = path.join(ROOT, 'public/assets/props');

/** Modèle Poly Haven → fichier du jeu, nombre de triangles visé, tolérance de simplification. */
const PROPS = [
  { id: 'barrel_03', file: 'barrel-blue', triangles: 1500 },
  { id: 'Barrel_01', file: 'barrel-red', triangles: 1600 },
  { id: 'metal_jerrycan', file: 'jerrycan', triangles: 1200 },
  // Parois fines : dessinées des deux côtés, sinon la caisse paraît trouée vue de l'intérieur.
  { id: 'plastic_crate_02', file: 'crate', triangles: 1600, doubleSided: true },
  // Médina
  { id: 'covered_car', file: 'covered-car', triangles: 3000 },
  // Dessous ouvert : dessiné des deux côtés. Simplifié plus fort, son dessous et ses pattes se déformaient.
  { id: 'exterior_aircon_unit', file: 'aircon', triangles: 5000, doubleSided: true },
  { id: 'planter_pot_clay', file: 'clay-pot', triangles: 600 },
  { id: 'potted_plant_01', file: 'potted-plant', triangles: 2000 },
  { id: 'ceramic_vase_04', file: 'jug', triangles: 600 },
  { id: 'plastic_monobloc_chair_01', file: 'plastic-chair', triangles: 1200, doubleSided: true },
  { id: 'painted_wooden_table', file: 'cafe-table', triangles: 800 },
  // Simplifiée plus fort, elle perdait son rebord du bas.
  { id: 'metal_trash_can', file: 'trash-can', triangles: 3000 },
  { id: 'Lantern_01', file: 'lantern', triangles: 800 },
];
const ERROR = 0.02;

const headers = { 'User-Agent': 'croissant-strike-props/1.0' };
async function download(url, file) {
  if (fs.existsSync(file)) return;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} : ${response.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

const triangles = (doc) =>
  doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives())
    .reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
fs.mkdirSync(OUT, { recursive: true });

for (const prop of PROPS) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${prop.id}`, { headers })).json();
  const gltf = files.gltf['1k'].gltf;
  const dir = path.join(CACHE, prop.id);
  await download(gltf.url, path.join(dir, `${prop.id}.gltf`));
  for (const [file, { url }] of Object.entries(gltf.include)) await download(url, path.join(dir, file));

  const source = await io.read(path.join(dir, `${prop.id}.gltf`));
  for (const material of source.getRoot().listMaterials()) {
    // « Transparent » sans transparence (texture JPEG) : opaque. Sinon le moteur trie mal les faces
    // des objets dessinés ensemble, et l'objet s'affiche de travers selon l'angle.
    if (material.getAlphaMode() === 'BLEND' && material.getBaseColorTexture()?.getMimeType() !== 'image/png') material.setAlphaMode('OPAQUE');
    if (prop.doubleSided) material.setDoubleSided(true);
  }
  await source.transform(dedup(), flatten(), join(), weld());
  const before = triangles(source);
  const base = await io.writeBinary(source);
  // Simplification par paliers jusqu'à passer sous la cible.
  let doc = source;
  for (let ratio = Math.min(1, prop.triangles / before), i = 0; ratio < 1 && i < 8; ratio *= 0.75, i++) {
    doc = await io.readBinary(base);
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: ERROR }));
    if (triangles(doc) <= prop.triangles * 1.1) break;
  }
  await doc.transform(
    // Couleur en 512 px, relief et rugosité/métal en 256 px : ce sont de petits objets.
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [512, 512], slots: /^baseColor/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [256, 256], slots: /^(normal|metallicRoughness|occlusion)/ }),
    prune(),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const glb = await io.writeBinary(doc);
  fs.writeFileSync(path.join(OUT, `${prop.file}.glb`), glb);
  console.log(`  ${prop.file}.glb : ${Math.round(before)} → ${Math.round(triangles(doc))} triangles, ${(glb.length / 1024).toFixed(0)} Ko`);
}
console.log(`Terminé : ${OUT}`);
