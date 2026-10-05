import { defineConfig } from 'vite';

export default defineConfig({
  // Three.js pèse à lui seul ~500 ko : inutile d'avertir pour ça.
  build: { chunkSizeWarningLimit: 1000 },
  // Pour faire tester le jeu à distance avec un tunnel Cloudflare (voir le README).
  preview: { allowedHosts: ['.trycloudflare.com'] },
});
