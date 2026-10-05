import type { NavGrid } from '../world/NavGrid';

/** Rayon couvert par le radar, en mètres. */
const RANGE = 28;

/**
 * Radar en haut à gauche, comme dans CS : la carte vue de dessus tourne avec
 * le regard (le haut du radar est devant soi), avec les ennemis repérés.
 */
export class Radar {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map: HTMLCanvasElement;
  private readonly bounds: { x: number; z: number; width: number; depth: number };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    nav: NavGrid,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const data = nav.mapData();
    this.bounds = { x: data.originX, z: data.originZ, width: data.cols * data.cell, depth: data.rows * data.cell };

    // Image de la carte : sol praticable en beige (plus clair en hauteur), le reste en sombre.
    this.map = document.createElement('canvas');
    this.map.width = data.cols;
    this.map.height = data.rows;
    const map = this.map.getContext('2d')!;
    const image = map.createImageData(data.cols, data.rows);
    for (let i = 0; i < data.cols * data.rows; i++) {
      const floor = data.floor[i];
      let rgba: [number, number, number, number];
      if (floor === -Infinity) rgba = [0, 0, 0, 0];
      else if (data.reachable[i]) {
        const light = Math.min(floor / 2.2, 1) * 45;
        rgba = [128 + light, 112 + light, 84 + light * 0.8, 230];
      } else rgba = [48, 44, 38, 230];
      image.data.set(rgba, i * 4);
    }
    map.putImageData(image, 0, 0);
  }

  draw(player: { x: number; z: number; yaw: number }, enemies: { x: number; z: number; alpha: number }[]): void {
    const { ctx, canvas } = this;
    const size = canvas.width;
    const half = size / 2;
    const scale = half / RANGE;
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();

    // Le monde tourne autour du joueur pour que son regard pointe vers le haut.
    ctx.translate(half, half);
    ctx.rotate(player.yaw);
    ctx.scale(scale, scale);
    ctx.translate(-player.x, -player.z);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.map, this.bounds.x, this.bounds.z, this.bounds.width, this.bounds.depth);

    for (const enemy of enemies) {
      ctx.globalAlpha = enemy.alpha;
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.z, 4.5 / scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Le joueur : une flèche au centre, vers le haut.
    ctx.fillStyle = '#4dff4d';
    ctx.beginPath();
    ctx.moveTo(half, half - 8);
    ctx.lineTo(half + 5.5, half + 6);
    ctx.lineTo(half, half + 3);
    ctx.lineTo(half - 5.5, half + 6);
    ctx.closePath();
    ctx.fill();
  }
}
