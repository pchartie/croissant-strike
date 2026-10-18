// Importe le Barrett M82 du « PSX Style Sniper Rifle Pack » (bigjigglydev, itch.io) : modèle remis au
// repère des armes du jeu (Blender), texture en pixels nets et silhouette pour le HUD.
//
// Utilisation : npm run import-sniper [chemin/vers/Barret.fbx]   (par défaut ~/Downloads/Barret.fbx)
// Résultat    : public/assets/weapons/sniper.glb, sniper.png, sniper-icon.png
// Il faut Blender 4.5 ou plus (BLENDER=/chemin/vers/blender si ce n'est pas l'emplacement macOS habituel).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.resolve(process.argv[2] ?? path.join(os.homedir(), 'Downloads/Barret.fbx'));
const OUT = path.join(ROOT, 'public/assets/weapons');
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
/** Hauteur des silhouettes d'armes du HUD (comme celles du Retro Weapon Pack). */
const ICON_HEIGHT = 48;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-'));
execFileSync(
  BLENDER,
  ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', path.join(ROOT, 'scripts/import-sniper.py'), '--', SOURCE, tmp],
  { stdio: ['ignore', 'pipe', 'inherit'] },
)
  .toString()
  .split('\n')
  .filter((line) => line.startsWith('[sniper]'))
  .forEach((line) => console.log(line));

fs.copyFileSync(path.join(tmp, 'sniper.glb'), path.join(OUT, 'sniper.glb'));

// La texture est une photo de profil sur fond blanc : les faces du dessus et du dessous, étirées sur la
// photo, tombent en partie sur le fond. On le remplace par le gris acier de l'arme…
const photo = await sharp(path.join(tmp, 'sniper-texture.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const STEEL = [43, 45, 48];
const model = Buffer.from(photo.data);
for (let i = 0; i < model.length; i += 3) {
  const white = Math.min(model[i], model[i + 1], model[i + 2]);
  const t = Math.max(0, Math.min(1, (white - 170) / 50));
  for (let c = 0; c < 3; c++) model[i + c] = Math.round(model[i + c] * (1 - t) + STEEL[c] * t);
}
await sharp(model, { raw: photo.info }).png().toFile(path.join(OUT, 'sniper.png'));

// … et on tire de la photo la silhouette du HUD : tout ce qui n'est pas blanc devient blanc opaque.
const { data, info } = await sharp(path.join(tmp, 'sniper-texture.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const rgba = Buffer.alloc(info.width * info.height * 4, 255);
for (let i = 0; i < info.width * info.height; i++) {
  const lightest = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
  rgba[i * 4 + 3] = Math.max(0, Math.min(255, (235 - lightest) * 6));
}
await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
  .trim({ threshold: 1 })
  .resize({ height: ICON_HEIGHT })
  .png()
  .toFile(path.join(OUT, 'sniper-icon.png'));

fs.rmSync(tmp, { recursive: true });
for (const file of ['sniper.glb', 'sniper.png', 'sniper-icon.png']) {
  console.log(`  ${file} (${(fs.statSync(path.join(OUT, file)).size / 1024).toFixed(1)} Ko)`);
}
