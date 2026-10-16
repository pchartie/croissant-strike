import type { NavGrid } from '../world/NavGrid';

/** Rayon couvert par le radar, en mètres. */
const RANGE = 28;
/** Coins arrondis du cadre (px) et ouverture du cône de vision (radians, ~ champ de vision de 75°). */
const CORNER = 10;
const VIEW_CONE = 1.6;

/**
 * Radar en haut à gauche, comme dans CS2 (carré arrondi) : la carte vue de dessus tourne avec
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
        const light = Math.min(floor / 2.2, 1) * 40;
        rgba = [150 + light, 140 + light, 122 + light * 0.9, 215];
      } else rgba = [40, 40, 38, 200];
      image.data.set(rgba, i * 4);
    }
    map.putImageData(image, 0, 0);
  }

  draw(
    player: { x: number; z: number; yaw: number },
    enemies: { x: number; z: number; alpha: number }[],
    allies: { x: number; z: number }[] = [],
  ): void {
    const { ctx, canvas } = this;
    const size = canvas.width;
    const half = size / 2;
    const scale = half / RANGE;
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, CORNER);
    ctx.clip();
    ctx.fillStyle = 'rgba(10, 12, 15, 0.6)';
    ctx.fillRect(0, 0, size, size);

    // Le monde tourne autour du joueur pour que son regard pointe vers le haut.
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(player.yaw);
    ctx.scale(scale, scale);
    ctx.translate(-player.x, -player.z);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.map, this.bounds.x, this.bounds.z, this.bounds.width, this.bounds.depth);

    // Points cerclés de sombre, lisibles sur le sol clair : coéquipiers en sable, ennemis en rouge.
    const dot = (x: number, z: number, color: string) => {
      ctx.beginPath();
      ctx.arc(x, z, 4.5 / scale, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.stroke();
    };
    for (const ally of allies) dot(ally.x, ally.z, '#f0cb85');
    for (const enemy of enemies) {
      ctx.globalAlpha = enemy.alpha;
      dot(enemy.x, enemy.z, '#ff3b30');
    }
    ctx.restore();

    // Cône de vision devant le joueur.
    const cone = ctx.createRadialGradient(half, half, 0, half, half, half * 0.9);
    cone.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    cone.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(half, half);
    ctx.arc(half, half, half * 0.9, -Math.PI / 2 - VIEW_CONE / 2, -Math.PI / 2 + VIEW_CONE / 2);
    ctx.closePath();
    ctx.fill();

    // Nord sur le bord, qui tourne avec la carte.
    const north = player.yaw - Math.PI / 2;
    const reach = half - 10;
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.fillText('N', half + Math.cos(north) * reach, half + Math.sin(north) * reach);
    ctx.restore();

    // Le joueur : une flèche blanche au centre, vers le haut.
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(half, half - 8);
    ctx.lineTo(half + 5.5, half + 6);
    ctx.lineTo(half, half + 3);
    ctx.lineTo(half - 5.5, half + 6);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
}
