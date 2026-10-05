import { defineConfig } from 'vite';

export default defineConfig({
  // Sous-dossier du site : « / » en local, « /projets/ » sur GitHub Pages (voir .github/workflows).
  base: process.env.VITE_BASE ?? '/',
  // Three.js pèse à lui seul ~500 ko : inutile d'avertir pour ça.
  build: { chunkSizeWarningLimit: 1000 },
  // Pour faire tester le jeu à distance avec un tunnel Cloudflare (voir le README).
  preview: { allowedHosts: ['.trycloudflare.com'] },
});
