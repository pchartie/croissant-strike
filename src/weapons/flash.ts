import * as THREE from 'three';

let shared: THREE.CanvasTexture | null = null;

/** Texture de flamme de canon : une étoile orangée avec un cœur lumineux. */
export function flashTexture(): THREE.CanvasTexture {
  if (shared) return shared;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  ctx.translate(c, c);
  ctx.fillStyle = 'rgba(255, 190, 90, 0.9)';
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(0, -c * (0.6 + Math.random() * 0.4));
    ctx.lineTo(6, 0);
    ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const glow = ctx.createRadialGradient(c, c, 0, c, c, c * 0.6);
  glow.addColorStop(0, 'rgba(255, 255, 230, 1)');
  glow.addColorStop(0.4, 'rgba(255, 200, 100, 0.8)');
  glow.addColorStop(1, 'rgba(255, 120, 30, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  shared = new THREE.CanvasTexture(canvas);
  shared.colorSpace = THREE.SRGBColorSpace;
  return shared;
}

/** Sprite de flamme, caché par défaut. */
export function flashSprite(): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: flashTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  sprite.visible = false;
  return sprite;
}
