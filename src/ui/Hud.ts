export class Hud {
  private readonly speed = document.getElementById('speed')!;
  private readonly crosshair = document.getElementById('crosshair')!;
  private readonly weaponName = document.getElementById('weapon-name')!;
  private readonly ammo = document.getElementById('ammo-count')!;
  private readonly reserve = document.getElementById('ammo-reserve')!;
  private readonly overlay = document.getElementById('overlay')!;
  private readonly status = document.getElementById('overlay-status')!;
  private lastSpeed = -1;
  private lastGap = -1;

  constructor(onPlay: () => void) {
    this.overlay.addEventListener('click', onPlay);
  }

  /** Vitesse horizontale affichée en unités Source, comme cl_showpos. */
  setSpeed(units: number): void {
    const rounded = Math.round(units);
    if (rounded === this.lastSpeed) return;
    this.lastSpeed = rounded;
    this.speed.textContent = String(rounded);
  }

  /** Écart du réticule en pixels : il montre la taille réelle du cône de dispersion. */
  setCrosshairGap(pixels: number): void {
    const rounded = Math.round(pixels);
    if (rounded === this.lastGap) return;
    this.lastGap = rounded;
    this.crosshair.style.setProperty('--gap', `${rounded}px`);
  }

  setAmmo(name: string, ammo: number, reserve: number): void {
    this.weaponName.textContent = name;
    this.ammo.textContent = String(ammo);
    this.ammo.classList.toggle('low', ammo === 0);
    this.reserve.textContent = String(reserve);
  }

  setPaused(paused: boolean): void {
    this.overlay.classList.toggle('hidden', !paused);
    this.status.textContent = 'Pause : cliquer pour reprendre';
  }
}
