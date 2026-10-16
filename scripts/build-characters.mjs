// Construit les soldats des bots : télécharge l'« Universal Animation Library » de Quaternius (CC0) sur
// OpenGameArt, habille son mannequin avec Blender (characters/build.py), puis compresse le résultat.
//
// Utilisation : npm run build-characters   (Blender 4.5 ou plus, BLENDER=… si besoin)
// Résultat    : public/assets/characters/soldiers.glb (deux tenues, T et CT, et leurs animations)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, quantize, resample } from '@gltf-transform/functions';
import { unzipSync } from 'fflate';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.characters-src');
const ZIP = 'universal_animation_librarystandard.zip';
const MANNEQUIN = 'Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb';
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const OUT = path.join(ROOT, 'public', 'assets', 'characters');

fs.mkdirSync(CACHE, { recursive: true });
const zipFile = path.join(CACHE, ZIP);
if (!fs.existsSync(zipFile)) {
  const response = await fetch(`https://opengameart.org/sites/default/files/${ZIP}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`Téléchargement impossible : ${response.status}`);
  fs.writeFileSync(zipFile, Buffer.from(await response.arrayBuffer()));
}
const mannequin = path.join(CACHE, 'mannequin.glb');
if (!fs.existsSync(mannequin)) fs.writeFileSync(mannequin, unzipSync(fs.readFileSync(zipFile), { filter: (file) => file.name === MANNEQUIN })[MANNEQUIN]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soldats-'));
const raw = path.join(tmp, 'soldiers.glb');
execFileSync(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', path.join(ROOT, 'characters', 'build.py'), '--', mannequin, raw], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(raw);
// Clés d'animation redondantes retirées, positions et rotations quantifiées, tout compressé (Meshopt).
await doc.transform(resample(), prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
fs.mkdirSync(OUT, { recursive: true });
await io.write(path.join(OUT, 'soldiers.glb'), doc);
fs.rmSync(tmp, { recursive: true });
console.log(`Soldats : ${Math.round(fs.statSync(path.join(OUT, 'soldiers.glb')).size / 1024)} Ko`);

// Tissus des tenues (Poly Haven, CC0), un par canal d'une image de 256 px : sergé (vêtements), toile
// épaisse (gilet) et cuir (gants, bottes). En niveaux de gris, centrés sur 0,5 : le jeu les multiplie à
// la couleur de chaque partie. On garde les plis et l'usure (quelques cm), pas la trame (moins d'un mm,
// invisible à distance de jeu), ni les variations très lentes (l'éclairage de la photo).
const FABRICS = ['denim_fabric_03', 'hessian_230', 'fabric_leather_01'];
const SIZE = 256;
const channels = [];
for (const id of FABRICS) {
  const file = path.join(CACHE, `${id}.jpg`);
  if (!fs.existsSync(file)) {
    const headers = { 'User-Agent': 'croissant-strike-characters/1.0' };
    const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers })).json();
    fs.writeFileSync(file, Buffer.from(await (await fetch(files.Diffuse['1k'].jpg.url, { headers })).arrayBuffer()));
  }
  const sharpGrey = await sharp(file).resize(SIZE, SIZE).greyscale().raw().toBuffer();
  const raw = { raw: { width: SIZE, height: SIZE, channels: 1 } };
  const grey = await sharp(sharpGrey, raw).blur(1.5).raw().toBuffer();
  const blurred = await sharp(sharpGrey, raw).blur(28).raw().toBuffer();
  let spread = 0;
  for (let i = 0; i < grey.length; i++) spread = Math.max(spread, Math.abs(grey[i] - blurred[i]));
  channels.push(Uint8Array.from(grey, (v, i) => Math.round(128 + ((v - blurred[i]) / Math.max(spread, 1)) * 120)));
}
const rgb = Buffer.alloc(SIZE * SIZE * 3);
for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = channels[c][i];
await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ quality: 90 }).toFile(path.join(OUT, 'fabric.webp'));
console.log(`Tissus : ${Math.round(fs.statSync(path.join(OUT, 'fabric.webp')).size / 1024)} Ko`);
