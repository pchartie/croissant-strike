// Construit une carte avec Blender (map/<nom>/build.py) : maillage, éclairage précalculé, collisions.
//
// Utilisation : npm run build-map -- <nom> [taille de la carte d'éclairage] [échantillons]
//               (par défaut : dunes 2048 256 ; `-- dunes 512 16` pour un essai rapide)
// Il faut Blender 4.5 ou plus (BLENDER=/chemin/vers/blender si ce n'est pas l'emplacement macOS habituel).
// Résultat    : public/maps/<nom>/ (maillage .glb compressé, éclairage .webp) et src/maps/<nom>.json
//               (collisions, objets, échelle de l'éclairage), inclus dans le code du jeu.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const [name = 'dunes', size = '2048', samples = '256'] = process.argv.slice(2);
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const script = path.join(ROOT, 'map', name, 'build.py');
if (!fs.existsSync(script)) throw new Error(`Pas de carte « ${name} » (${script} absent)`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `carte-${name}-`));
const started = Date.now();
execFileSync(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', tmp, size, samples], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(path.join(tmp, `${name}.glb`));
// Les UV restent (les textures sont appliquées par le jeu) ; en 16 bits : la carte d'éclairage a besoin de précision (un pixel sur 2048 ou 4096).
await doc.transform(prune({ keepAttributes: true }), reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 16, quantizeTexcoord: 16, quantizeNormal: 10 }), meshopt({ encoder: MeshoptEncoder }));

const out = path.join(ROOT, 'public', 'maps', name);
fs.mkdirSync(out, { recursive: true });
await io.write(path.join(out, `${name}.glb`), doc);
await sharp(path.join(tmp, 'lightmap.png')).webp({ quality: 90, effort: 6 }).toFile(path.join(out, 'lightmap.webp'));
fs.mkdirSync(path.join(ROOT, 'src', 'maps'), { recursive: true });
fs.copyFileSync(path.join(tmp, `${name}.json`), path.join(ROOT, 'src', 'maps', `${name}.json`));
fs.rmSync(tmp, { recursive: true });

const kb = (file) => `${Math.round(fs.statSync(path.join(out, file)).size / 1024)} Ko`;
console.log(`Carte ${name} : ${name}.glb ${kb(`${name}.glb`)}, lightmap.webp ${kb('lightmap.webp')} (${Math.round((Date.now() - started) / 1000)} s)`);
