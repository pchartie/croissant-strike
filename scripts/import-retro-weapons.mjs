// Extrait du Retro Weapon Pack (zip) les fichiers utilisés par le jeu et
// compresse les animations, livrées en FBX de plusieurs dizaines de Mo.
//
// Utilisation : npm run import-weapons [chemin/vers/RetroWeaponPack_V1.zip]
// Résultat    : public/assets/weapons/

import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, unzlibSync, zlibSync } from 'fflate';
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
  ['Guns/SMG_01/Fbx_Files/SMG_01.fbx', 'smg.fbx'],
  ['Guns/SMG_01/Fbx_Files/SMG_01_AdditionalMeshes.fbx', 'smg-extra.fbx'],
  ['Guns/SMG_01/Textures/SMG_01_Albedo.png', 'smg.png'],
  ['Guns/Shotgun_01/FbxFiles/Shotgun_01.fbx', 'shotgun.fbx'],
  ['Guns/Shotgun_01/Textures/Shotgun_01_Albedo.png', 'shotgun.png'],
  ['Guns/AdditionalMeshes/Projectiles/FbxFile/Projectiles.fbx', 'projectiles.fbx'],
  ['Guns/AdditionalMeshes/Projectiles/Texture/Projectiles_Albedo.png', 'projectiles.png'],
  ['FX/Textures/MuzzleFlash.png', 'muzzleflash.png'],
  ['FX/Meshes/Wallhit_Debris.fbx', 'debris.fbx'],
];

/** Animations regroupées par fichier de sortie : nom du clip → chemin dans le pack. */
function armsClips(gun, extra = {}) {
  const dir = `FP_Arms/FBX_Files/Animations/${gun}_Animations/`;
  const one = (name) => `${dir}OneTimeAnimations/FP_Arms_${gun}_${name}.fbx`;
  return {
    ...Object.fromEntries(Object.entries(extra).map(([clip, name]) => [clip, one(name)])),
    idle: `${dir}Cycles/FP_Arms_${gun}_Breathing.fbx`,
    walk: `${dir}Cycles/FP_Arms_${gun}_Walk.fbx`,
    run: `${dir}Cycles/FP_Arms_${gun}_Run.fbx`,
    fire: `${dir}OneTimeAnimations/FP_Arms_${gun}_Fire.fbx`,
    ...(extra.reloadStart ? {} : { reload: one('Reload') }),
    draw: `${dir}TransitionAnimations/FP_Arms_${gun}_Draw.fbx`,
    hide: `${dir}TransitionAnimations/FP_Arms_${gun}_Hide.fbx`,
    crouchIdle: `${dir}Cycles/FP_Arms_${gun}_Breathing_Crouching.fbx`,
    crouchWalk: `${dir}Cycles/FP_Arms_${gun}_Walk_Crouching.fbx`,
  };
}

/** Silhouettes des armes (512 × 256, blanc sur transparent) : recadrées et réduites pour le HUD. */
const ICONS = [
  ['Guns/Rifle_01/Textures/Rifle_01_silhouette.png', 'rifle-icon.png'],
  ['Guns/Pistol_01/Textures/Pistol_01_silhouette.png', 'pistol-icon.png'],
  ['Guns/SMG_01/Textures/SMG_01_silhouette.png', 'smg-icon.png'],
  ['Guns/Shotgun_01/Textures/Shotgun_01_silhouette.png', 'shotgun-icon.png'],
];
/** Hauteur des icônes (le HUD les affiche plus petites, nettes sur les écrans haute densité). */
const ICON_HEIGHT = 48;

const ANIMATIONS = {
  'arms-rifle.json': armsClips('Rifle_01'),
  'arms-pistol.json': armsClips('Pistol_01'),
  'arms-smg.json': armsClips('SMG_01'),
  // Fusil à pompe : rechargement cartouche par cartouche (début, une cartouche, fin).
  'arms-shotgun.json': armsClips('Shotgun_01', { reloadStart: 'ReloadStart', reloadStep: 'ReloadStep', reloadEnd: 'ReloadEnd' }),
  'rifle-anims.json': {
    fire: 'Guns/Rifle_01/Fbx_Files/Animations/Rifle_01_Fire.fbx',
    reload: 'Guns/Rifle_01/Fbx_Files/Animations/Rifle_01_Reload.fbx',
  },
  'pistol-anims.json': {
    fire: 'Guns/Pistol_01/FbxFiles/Animations/Pistol_01_Fire.fbx',
    reload: 'Guns/Pistol_01/FbxFiles/Animations/Pistol_01_Reload.fbx',
    empty: 'Guns/Pistol_01/FbxFiles/Animations/Pistol_01_EmptyMagazine.fbx',
  },
  'smg-anims.json': {
    fire: 'Guns/SMG_01/Fbx_Files/Animations/SMG_01_Fire.fbx',
    reload: 'Guns/SMG_01/Fbx_Files/Animations/SMG_01_Reload.fbx',
  },
  'shotgun-anims.json': {
    fire: 'Guns/Shotgun_01/FbxFiles/Animations/Shotgun_01_Fire.fbx',
    reloadStep: 'Guns/Shotgun_01/FbxFiles/Animations/Shotgun_01_ReloadStep.fbx',
    reloadEnd: 'Guns/Shotgun_01/FbxFiles/Animations/Shotgun_01_ReloadEnd.fbx',
  },
};

if (!fs.existsSync(ZIP)) {
  console.error(`Zip introuvable : ${ZIP}`);
  process.exit(1);
}

const needed = new Set([
  ...COPIES.map(([file]) => PACK + file),
  ...ICONS.map(([file]) => PACK + file),
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

for (const [file, name] of ICONS) {
  const icon = encodePng(shrink(trim(decodePng(files[PACK + file])), ICON_HEIGHT));
  fs.writeFileSync(path.join(OUT, name), icon);
  console.log(`  ${name} (${(icon.length / 1024).toFixed(1)} Ko)`);
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

// --- Images PNG (RGBA 8 bits, sans entrelacement : le format des silhouettes du pack) ---

/** Décode un PNG en { width, height, data } (data : RGBA, 4 octets par pixel). */
function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  const idat = [];
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('PNG non pris en charge (RGBA 8 bits attendu)');
    }
    if (type === 'IDAT') idat.push(body);
    at += 12 + length;
  }
  const raw = unzlibSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[y * stride + x - 4] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][filter];
      data[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  return { width, height, data };
}

/** Recadre au plus près des pixels visibles. */
function trim(image) {
  const { width, height, data } = image;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(data.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x1 + 1) * 4), y * w * 4);
  return { width: w, height: h, data: out };
}

/** Réduit à la hauteur voulue (moyenne des pixels couverts, couleurs pondérées par l'opacité). */
function shrink(image, targetHeight) {
  const scale = image.height / targetHeight;
  const width = Math.max(1, Math.round(image.width / scale));
  const out = new Uint8Array(width * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++)
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0, 0];
      let count = 0;
      for (let sy = Math.floor(y * scale); sy < Math.min(image.height, Math.ceil((y + 1) * scale)); sy++)
        for (let sx = Math.floor(x * scale); sx < Math.min(image.width, Math.ceil((x + 1) * scale)); sx++) {
          const i = (sy * image.width + sx) * 4;
          const alpha = image.data[i + 3];
          for (let k = 0; k < 3; k++) sum[k] += image.data[i + k] * alpha;
          sum[3] += alpha;
          count++;
        }
      const o = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) out[o + k] = sum[3] ? Math.round(sum[k] / sum[3]) : 0;
      out[o + 3] = Math.round(sum[3] / count);
    }
  return { width, height: targetHeight, data: out };
}

function encodePng({ width, height, data }) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
