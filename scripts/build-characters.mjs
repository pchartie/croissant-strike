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
