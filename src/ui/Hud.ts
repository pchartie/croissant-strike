export class Hud {
  private readonly speed = document.getElementById('speed')!;
  private readonly overlay = document.getElementById('overlay')!;
  private readonly status = document.getElementById('overlay-status')!;
  private lastSpeed = -1;

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

  setPaused(paused: boolean): void {
    this.overlay.classList.toggle('hidden', !paused);
    this.status.textContent = 'Pause : cliquer pour reprendre';
  }
}
