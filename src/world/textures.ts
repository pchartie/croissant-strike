import * as THREE from 'three';

// Textures générées par le code, en attendant de vraies textures.

const SIZE = 256;

function makeTexture(
  anisotropy: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  addNoise(ctx, 18);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

function addNoise(ctx: CanvasRenderingContext2D, amount: number): void {
  const image = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

/** Dalles de béton : une texture couvre 2 × 2 dalles. */
export function concrete(anisotropy: number): THREE.CanvasTexture {
  return makeTexture(anisotropy, (ctx) => {
    ctx.fillStyle = '#8d8a82';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(60, 55, 50, ${Math.random() * 0.08})`;
      const r = 10 + Math.random() * 40;
      ctx.beginPath();
      ctx.arc(Math.random() * SIZE, Math.random() * SIZE, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#5e5b55';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, SIZE, SIZE);
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, 0);
    ctx.lineTo(SIZE / 2, SIZE);
    ctx.moveTo(0, SIZE / 2);
    ctx.lineTo(SIZE, SIZE / 2);
    ctx.stroke();
  });
}

/** Briques beiges, style mur de dust. */
export function bricks(anisotropy: number): THREE.CanvasTexture {
  return makeTexture(anisotropy, (ctx) => {
    ctx.fillStyle = '#9c8d72';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const rows = 8;
    const h = SIZE / rows;
    const w = SIZE / 4;
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : w / 2;
      for (let col = -1; col < 5; col++) {
        const shade = 190 + Math.random() * 30;
        ctx.fillStyle = `rgb(${shade}, ${shade * 0.88}, ${shade * 0.7})`;
        ctx.fillRect(col * w + offset + 2, row * h + 2, w - 4, h - 4);
      }
    }
  });
}

/** Caisse en bois avec cadre et renfort en diagonale. */
export function crate(anisotropy: number): THREE.CanvasTexture {
  return makeTexture(anisotropy, (ctx) => {
    const planks = 5;
    const h = SIZE / planks;
    for (let i = 0; i < planks; i++) {
      const shade = 120 + Math.random() * 25;
      ctx.fillStyle = `rgb(${shade}, ${shade * 0.72}, ${shade * 0.42})`;
      ctx.fillRect(0, i * h, SIZE, h);
      ctx.fillStyle = 'rgba(40, 25, 10, 0.5)';
      ctx.fillRect(0, i * h, SIZE, 2);
    }
    const frame = 26;
    ctx.fillStyle = '#6b4a26';
    ctx.fillRect(0, 0, SIZE, frame);
    ctx.fillRect(0, SIZE - frame, SIZE, frame);
    ctx.fillRect(0, 0, frame, SIZE);
    ctx.fillRect(SIZE - frame, 0, frame, SIZE);
    ctx.strokeStyle = '#6b4a26';
    ctx.lineWidth = frame;
    ctx.beginPath();
    ctx.moveTo(frame, SIZE - frame);
    ctx.lineTo(SIZE - frame, frame);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30, 18, 6, 0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);
    ctx.strokeRect(frame, frame, SIZE - frame * 2, SIZE - frame * 2);
  });
}

/** Sable tassé, pour le sol extérieur. */
export function sand(anisotropy: number): THREE.CanvasTexture {
  return makeTexture(anisotropy, (ctx) => {
    ctx.fillStyle = '#c9ad7f';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 120; i++) {
      const light = Math.random() < 0.5;
      ctx.fillStyle = light ? `rgba(240, 222, 185, ${Math.random() * 0.12})` : `rgba(120, 95, 60, ${Math.random() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * SIZE, Math.random() * SIZE, 6 + Math.random() * 30, 3 + Math.random() * 12, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Crépi beige avec des taches, pour les murs des bâtiments. */
export function plaster(anisotropy: number): THREE.CanvasTexture {
  return makeTexture(anisotropy, (ctx) => {
    ctx.fillStyle = '#d8c39b';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 25; i++) {
      ctx.fillStyle = `rgba(150, 120, 80, ${Math.random() * 0.12})`;
      ctx.beginPath();
      ctx.arc(Math.random() * SIZE, Math.random() * SIZE, 15 + Math.random() * 50, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
