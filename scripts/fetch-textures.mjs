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
  terracotta: 'patterned_terracotta_tiling',
  mosaic: 'marble_mosaic_tiles',
  bluePlanks: 'blue_painted_planks',
  greenPlanks: 'green_rough_planks',
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
