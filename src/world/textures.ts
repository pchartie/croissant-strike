import * as THREE from 'three';

// Textures dessinées par le code : caisse, et quadrillage des cartes en version grise (les autres
// matériaux des cartes sont des textures Poly Haven).

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

/** Quadrillage de la version grise d'une carte : un carreau par mètre, une ligne fine tous les 50 cm. */
export function grid(anisotropy: number): THREE.CanvasTexture {
  return makeTexture(anisotropy, (ctx) => {
    ctx.fillStyle = '#ebebeb';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, 0);
    ctx.lineTo(SIZE / 2, SIZE);
    ctx.moveTo(0, SIZE / 2);
    ctx.lineTo(SIZE, SIZE / 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, SIZE, SIZE);
  });
}
