// Extrait du Retro Weapon Pack (zip) les fichiers utilisés par le jeu et
// compresse les animations, livrées en FBX de plusieurs dizaines de Mo.
//
// Utilisation : npm run import-weapons [chemin/vers/RetroWeaponPack_V1.zip]
// Résultat    : public/assets/weapons/

import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ZIP = path.resolve(process.argv[2] ?? path.join(ROOT, 'RetroWeaponPack_V1.zip'));
const OUT = path.join(ROOT, 'public/assets/weapons');
const PACK = 'Assets/RetroWeaponsPack/';
const FPS = 30;

// FBXLoader s'attend à un navigateur : on lui donne juste de quoi ne pas planter.
// Les textures sont copiées à part et appliquées par le jeu.
globalThis.self = globalThis;
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }),
  createElement: () => ({}),
};
console.warn = () => {};

/** Fichiers copiés tels quels : [chemin dans le pack, nom de sortie]. */
const COPIES = [
  ['FP_Arms/FBX_Files/FP_Arms.fbx', 'arms.fbx'],
  ['FP_Arms/Texture/FPS_Arms_Albedo.png', 'arms.png'],
  ['Guns/Rifle_01/Fbx_Files/Rifle_01.fbx', 'rifle.fbx'],
  ['Guns/Rifle_01/Fbx_Files/Rifle_01_AdditionalMeshes.fbx', 'rifle-extra.fbx'],
  ['Guns/Rifle_01/Textures/Rifle_01_Albedo.png', 'rifle.png'],
  ['Guns/Pistol_01/FbxFiles/Pistol_01.fbx', 'pistol.fbx'],
  ['Guns/Pistol_01/FbxFiles/Pistol_01_AdditionalMeshes.fbx', 'pistol-extra.fbx'],
  ['Guns/Pistol_01/Textures/Pistol_01_Albedo.png', 'pistol.png'],
  ['Guns/AdditionalMeshes/Projectiles/Texture/Projectiles_Albedo.png', 'projectiles.png'],
  ['FX/Textures/MuzzleFlash.png', 'muzzleflash.png'],
];

/** Animations regroupées par fichier de sortie : nom du clip → chemin dans le pack. */
function armsClips(gun) {
  const dir = `FP_Arms/FBX_Files/Animations/${gun}_Animations/`;
  return {
    idle: `${dir}Cycles/FP_Arms_${gun}_Breathing.fbx`,
    walk: `${dir}Cycles/FP_Arms_${gun}_Walk.fbx`,
    run: `${dir}Cycles/FP_Arms_${gun}_Run.fbx`,
    fire: `${dir}OneTimeAnimations/FP_Arms_${gun}_Fire.fbx`,
    reload: `${dir}OneTimeAnimations/FP_Arms_${gun}_Reload.fbx`,
    draw: `${dir}TransitionAnimations/FP_Arms_${gun}_Draw.fbx`,
  };
}

const ANIMATIONS = {
  'arms-rifle.json': armsClips('Rifle_01'),
  'arms-pistol.json': armsClips('Pistol_01'),
  'rifle-anims.json': {
    fire: 'Guns/Rifle_01/Fbx_Files/Animations/Rifle_01_Fire.fbx',
    reload: 'Guns/Rifle_01/Fbx_Files/Animations/Rifle_01_Reload.fbx',
  },
  'pistol-anims.json': {
    fire: 'Guns/Pistol_01/FbxFiles/Animations/Pistol_01_Fire.fbx',
    reload: 'Guns/Pistol_01/FbxFiles/Animations/Pistol_01_Reload.fbx',
    empty: 'Guns/Pistol_01/FbxFiles/Animations/Pistol_01_EmptyMagazine.fbx',
  },
};

if (!fs.existsSync(ZIP)) {
  console.error(`Zip introuvable : ${ZIP}`);
  process.exit(1);
}

const needed = new Set([
  ...COPIES.map(([file]) => PACK + file),
  ...Object.values(ANIMATIONS).flatMap((clips) => Object.values(clips).map((file) => PACK + file)),
]);
console.log(`Lecture de ${path.basename(ZIP)}…`);
const files = unzipSync(fs.readFileSync(ZIP), { filter: (entry) => needed.has(entry.name) });
for (const file of needed) {
  if (!files[file]) throw new Error(`Absent du zip : ${file}`);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [file, name] of COPIES) {
  fs.writeFileSync(path.join(OUT, name), files[PACK + file]);
  console.log(`  ${name}`);
}

for (const [output, clips] of Object.entries(ANIMATIONS)) {
  const json = [];
  for (const [name, file] of Object.entries(clips)) {
    const bytes = files[PACK + file];
    const fbx = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const clip = compact(fbx.animations[0], name);
    json.push(THREE.AnimationClip.toJSON(clip));
  }
  const text = JSON.stringify(json);
  fs.writeFileSync(path.join(OUT, output), text);
  console.log(`  ${output} (${(text.length / 1024).toFixed(0)} Ko)`);
}
console.log(`Terminé : ${OUT}`);

/** Rééchantillonne à 30 images/s, retire ce qui ne bouge pas et arrondit les valeurs. */
function compact(clip, name) {
  const tracks = [];
  for (const track of clip.tracks) {
    const size = track.getValueSize();
    let times = track.times;
    let values = track.values;

    const frames = Math.max(1, Math.round(clip.duration * FPS));
    if (times.length > frames + 1) {
      const interpolant = track.createInterpolant();
      times = new Float32Array(frames + 1);
      values = new Float32Array((frames + 1) * size);
      for (let f = 0; f <= frames; f++) {
        times[f] = Math.min(f / FPS, clip.duration);
        values.set(interpolant.evaluate(times[f]), f * size);
      }
    }

    const round = (v) => Math.round(v * 1e4) / 1e4;
    const resampled = new track.constructor(track.name, Array.from(times, round), Array.from(values, round));
    resampled.optimize();

    // Une échelle qui reste à 1 n'apporte rien.
    if (track.name.endsWith('.scale') && resampled.values.every((v) => Math.abs(v - 1) < 1e-3)) continue;
    tracks.push(resampled);
  }
  return new THREE.AnimationClip(name, clip.duration, tracks);
}
