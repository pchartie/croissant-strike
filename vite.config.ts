import { defineConfig } from 'vite';

export default defineConfig({
  // Three.js pèse à lui seul ~500 ko : inutile d'avertir pour ça.
  build: { chunkSizeWarningLimit: 1000 },
});
