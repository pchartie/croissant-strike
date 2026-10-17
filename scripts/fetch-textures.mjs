// Télécharge les textures des cartes sur Poly Haven (CC0) : couleur seulement, en 1k, converties en
// WebP. Le relief et les ombres viennent de l'éclairage précalculé des cartes, d'où pas de normal map.
//
// Utilisation : npm run fetch-textures
// Résultat    : public/textures/<nom>_diff.webp, et public/textures/CREDITS.md (auteurs, taille réelle)

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'textures');

/** Nom dans le jeu → texture Poly Haven. */
const TEXTURES = {
  ground: 'gravelly_sand',
  plaster: 'clay_plaster',
  sandstone: 'sandstone_blocks_08',
  wood: 'brown_planks_05',
  clay: 'patterned_clay_plaster',
  redPlaster: 'red_plaster_weathered',
  cobble: 'cobblestone_floor_01',
  packedSand: 'dense_sand',
  paving: 'rectangular_paving',
  stoneTiles: 'floor_tiles_08',
  mosaic: 'marble_mosaic_tiles',
  bluePlanks: 'blue_painted_planks',
  greenPlanks: 'green_rough_planks',
  roofTiles: 'clay_roof_tiles_02',
  // Bois des caisses (assemblées plus bas en caisses à cadre et écharpe).
  pineBoards: 'raw_plank_wall',
  weatheredBoards: 'weathered_brown_planks',
};

const headers = { 'User-Agent': 'croissant-strike-textures/1.0' };
const json = async (url) => (await fetch(url, { headers })).json();

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [name, id] of Object.entries(TEXTURES)) {
  const [info, files] = await Promise.all([json(`https://api.polyhaven.com/info/${id}`), json(`https://api.polyhaven.com/files/${id}`)]);
  const file = path.join(OUT, `${name}_diff.webp`);
  if (!fs.existsSync(file)) {
    const url = files.Diffuse['1k'].jpg.url;
    const image = Buffer.from(await (await fetch(url, { headers })).arrayBuffer());
    await sharp(image).webp({ quality: 85 }).toFile(file);
  }
  // Taille réelle d'un motif (m), pour la répéter à la bonne échelle (map/lib/kit.py).
  const size = Math.round(info.dimensions[0] / 10) / 100;
  rows.push(`| \`${name}_diff.webp\` | [${info.name}](https://polyhaven.com/a/${id}) | ${Object.keys(info.authors).join(', ')} | ${String(size).replace('.', ',')} m |`);
  console.log(`${name} ← ${id} (${size} m, ${Math.round(fs.statSync(file).size / 1024)} Ko)`);
}

fs.writeFileSync(
  path.join(OUT, 'CREDITS.md'),
  `# Textures

Textures de [Poly Haven](https://polyhaven.com), licence **CC0** (domaine public). Version 1k, couleur seulement (WebP), téléchargées par \`npm run fetch-textures\` : le relief et les ombres viennent de l'éclairage précalculé des cartes.

| Fichier | Texture | Auteur | Taille réelle |
|---|---|---|---|
${rows.join('\n')}
`,
);

// --- Caisses : planches de la photo, cadre et écharpe (diagonale) en planches plus sombres posées en
// travers, joints sombres, clous aux coins. Trois bois pour que les caisses ne soient pas toutes pareilles.
const CRATE = 512;
async function crate(name, source, { frameBrightness = 0.72, tint = null } = {}) {
  const file = path.join(OUT, `${source}_diff.webp`);
  const prepare = (image) => (tint ? image.tint(tint) : image).resize(CRATE, CRATE).removeAlpha().raw().toBuffer();
  const boards = await prepare(sharp(file));
  const frame = await prepare(sharp(file).rotate(90).modulate({ brightness: frameBrightness }));
  const out = Buffer.alloc(CRATE * CRATE * 3);
  const border = 54;
  const band = 40; // demi-largeur de l'écharpe, mesurée sur x + y
  for (let y = 0; y < CRATE; y++) {
    for (let x = 0; x < CRATE; x++) {
      const i = (y * CRATE + x) * 3;
      const edge = Math.min(x, y, CRATE - 1 - x, CRATE - 1 - y);
      const inner = edge >= border;
      const diagonal = inner && Math.abs(x + y - CRATE) < band;
      let source = inner && !diagonal ? boards : frame;
      // Joints : contour de la caisse, bord intérieur du cadre, bords de l'écharpe.
      let shade = 1;
      if (edge < 3) shade = 0.45;
      else if (Math.abs(edge - border) < 2) shade = 0.5;
      else if (inner && Math.abs(Math.abs(x + y - CRATE) - band) < 2) shade = 0.55;
      // Clous dans les coins du cadre.
      for (const [cx, cy] of [[27, 27], [CRATE - 27, 27], [27, CRATE - 27], [CRATE - 27, CRATE - 27]]) {
        if ((x - cx) ** 2 + (y - cy) ** 2 < 25) shade = 0.35;
      }
      for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, source[i + c] * shade);
    }
  }
  const target = path.join(OUT, `${name}_diff.webp`);
  await sharp(out, { raw: { width: CRATE, height: CRATE, channels: 3 } }).webp({ quality: 85 }).toFile(target);
  console.log(`${name} ← caisse en ${source} (${Math.round(fs.statSync(target).size / 1024)} Ko)`);
}
await crate('crateLight', 'pineBoards');
await crate('crateDark', 'weatheredBoards', { frameBrightness: 0.8 });
await crate('crateGreen', 'pineBoards', { tint: { r: 92, g: 112, b: 70 } });
