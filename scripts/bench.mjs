// Mesure de performance : ouvre le jeu (serveur de développement), place la caméra à des points fixes,
// dessine 60 images synchronisées avec la carte graphique à chaque point, et affiche le temps par image,
// les appels de dessin et les triangles. Prend aussi une capture de chaque point.
//
// Utilisation : npm run dev                    (dans un autre terminal)
//               npm run bench -- [nom] [carte]  (captures et résultats dans bench/<nom>/, ignoré par git ;
//                                               carte : dunes par défaut, ou medina)
// Options     : BROWSER=/chemin/vers/chrome (par défaut Brave sur macOS), HEADFUL=1 pour voir la fenêtre,
//               URL=http://localhost:5173/, PREP='<code JS>' exécuté dans la page avant la mesure
//               (par exemple PREP='game.bots.bots.forEach(b => b.model.root.visible = false)').
//
// Le temps mesuré comprend la synchronisation (lecture d'un pixel) : quelques ms fixes, à comparer
// d'une mesure à l'autre sur la même machine, pas à un compteur d'images en jeu.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const label = process.argv[2] ?? 'mesure';
const map = process.argv[3] ?? 'dunes';
const url = process.env.URL ?? 'http://localhost:5173/';
const outDir = path.join(ROOT, 'bench', label);
fs.mkdirSync(outDir, { recursive: true });

/** Points de vue de chaque carte : position de l'œil, lacet et tangage (radians ; lacet 0 = vers le nord). */
const VIEWS = {
  dunes: [
    { name: 'spawn-sud', pos: [0, 1.7, 31], yaw: 0, pitch: 0 },
    { name: 'milieu', pos: [2, 1.7, 10], yaw: 0, pitch: -0.05 },
    { name: 'longue-a', pos: [-17, 1.7, 18], yaw: 0, pitch: 0 },
    { name: 'site-a', pos: [-20, 1.7, -8], yaw: 0.9, pitch: -0.05 },
    { name: 'site-b', pos: [17, 1.7, 8], yaw: -0.4, pitch: -0.05 },
    { name: 'vue-large', pos: [30, 6, 30], yaw: 0.78, pitch: -0.15 },
  ],
  medina: [
    { name: 'spawn-t', pos: [0, 1.7, 44], yaw: 0, pitch: 0 },
    { name: 'longue', pos: [-35, 1.7, 28], yaw: 0, pitch: 0 },
    { name: 'site-a', pos: [-36, 2.9, -10], yaw: -0.6, pitch: -0.08 },
    { name: 'milieu', pos: [0, 1.7, 30], yaw: 0, pitch: 0 },
    { name: 'souk', pos: [26, 1.7, 34], yaw: 0, pitch: 0 },
    { name: 'site-b', pos: [22, 1.7, 2], yaw: -0.5, pitch: -0.05 },
  ],
}[map];

const browser = await puppeteer.launch({
  executablePath: process.env.BROWSER ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  headless: process.env.HEADFUL ? false : 'new',
  args: ['--window-size=1280,720', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--no-first-run'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
// Choisit la carte avant le chargement (réglages du jeu dans le stockage du navigateur).
await page.evaluateOnNewDocument((map) => {
  const settings = JSON.parse(localStorage.getItem('fps1.settings') ?? '{}');
  localStorage.setItem('fps1.settings', JSON.stringify({ ...settings, map }));
}, map);
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.game, { timeout: 60000 });
// Laisse arriver la carte, les modèles et le ciel.
await new Promise((resolve) => setTimeout(resolve, 6000));

const gpu = await page.evaluate(() => {
  const gl = window.game.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'inconnue';
});
if (process.env.PREP) await page.evaluate(process.env.PREP);

const results = [];
for (const view of VIEWS) {
  const result = await page.evaluate((view) => {
    const { renderer, scene, camera } = window.game;
    renderer.setAnimationLoop(null);
    // Menu et interface cachés pour des captures propres.
    for (const el of document.querySelectorAll('body > *:not(canvas)')) el.style.visibility = 'hidden';
    camera.position.set(...view.pos);
    camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
    const gl = renderer.getContext();
    const pixel = new Uint8Array(4);
    const draw = () => {
      renderer.clear();
      renderer.render(scene, camera);
    };
    for (let i = 0; i < 10; i++) draw();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    renderer.info.autoReset = false;
    renderer.info.reset();
    const frames = 60;
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      draw();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    }
    const ms = (performance.now() - start) / frames;
    const calls = Math.round(renderer.info.render.calls / frames);
    const triangles = Math.round(renderer.info.render.triangles / frames);
    renderer.info.autoReset = true;
    return { ms: +ms.toFixed(2), calls, triangles, textures: renderer.info.memory.textures };
  }, view);
  await page.screenshot({ path: path.join(outDir, `${view.name}.png`) });
  results.push({ view: view.name, ...result });
}

console.log(`Carte graphique : ${gpu}`);
console.table(results);
const average = results.reduce((sum, r) => sum + r.ms, 0) / results.length;
console.log(`Moyenne : ${average.toFixed(2)} ms par image (~${Math.round(1000 / average)} i/s) — captures dans bench/${label}/`);
fs.writeFileSync(path.join(outDir, 'resultats.json'), JSON.stringify({ gpu, average, results, logs }, null, 2));
const errors = logs.filter((line) => line.startsWith('error') || line.startsWith('pageerror'));
if (errors.length) console.log('Erreurs dans la page :', errors.slice(0, 10));
await browser.close();
