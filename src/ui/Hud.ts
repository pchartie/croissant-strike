const KILLFEED_DURATION = 5000;
const KILLFEED_MAX = 5;

export class Hud {
  private readonly speed = document.getElementById('speed')!;
  private readonly weaponName = document.getElementById('weapon-name')!;
  private readonly ammo = document.getElementById('ammo-count')!;
  private readonly reserve = document.getElementById('ammo-reserve')!;
  private readonly health = document.getElementById('health-value')!;
  private readonly score = document.getElementById('score')!;
  private readonly killfeed = document.getElementById('killfeed')!;
  private readonly hitmarker = document.getElementById('hitmarker')!;
  private readonly damage = document.getElementById('damage')!;
  private readonly death = document.getElementById('death')!;
  private readonly deathText = document.getElementById('death-text')!;
  private readonly overlay = document.getElementById('overlay')!;
  private readonly status = document.getElementById('overlay-status')!;
  private lastSpeed = -1;
  private lastAmmo = '';
  private lastHealth = -1;

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

  setAmmo(name: string, ammo: number, reserve: number): void {
    const key = `${name}|${ammo}|${reserve}`;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    this.weaponName.textContent = name;
    this.ammo.textContent = String(ammo);
    this.ammo.classList.toggle('low', ammo === 0);
    this.reserve.textContent = String(reserve);
  }

  setHealth(health: number): void {
    const value = Math.max(0, Math.ceil(health));
    if (value === this.lastHealth) return;
    this.lastHealth = value;
    this.health.textContent = String(value);
    this.health.classList.toggle('low', value <= 25);
  }

  setScore(kills: number, deaths: number): void {
    this.score.textContent = `Éliminations ${kills}   ·   Morts ${deaths}`;
  }

  /** Petite croix autour du réticule quand une balle touche un bot. */
  showHitmarker(headshot: boolean): void {
    this.restartAnimation(this.hitmarker, headshot ? 'show head' : 'show');
  }

  /** Bords de l'écran qui rougissent quand le joueur est touché. */
  showDamage(): void {
    this.restartAnimation(this.damage, 'show');
  }

  addKill(killer: string, victim: string, weapon: string, headshot: boolean): void {
    const entry = document.createElement('div');
    entry.className = 'kill';
    if (killer === 'Toi') entry.classList.add('mine');
    if (victim === 'Toi') entry.classList.add('me');
    const parts = [killer, `[${weapon}${headshot ? ' · tête' : ''}]`, victim];
    for (const [i, text] of parts.entries()) {
      const span = document.createElement('span');
      span.textContent = text;
      if (i === 1) span.className = 'weapon';
      entry.append(span);
    }
    this.killfeed.prepend(entry);
    while (this.killfeed.children.length > KILLFEED_MAX) this.killfeed.lastElementChild!.remove();
    setTimeout(() => entry.remove(), KILLFEED_DURATION);
  }

  /** Affiche l'écran de mort, ou le cache si `secondsLeft` est null. */
  setDeath(killer: string | null, secondsLeft: number | null): void {
    this.death.classList.toggle('hidden', secondsLeft === null);
    if (secondsLeft !== null) {
      this.deathText.textContent = `Tué par ${killer} · réapparition dans ${Math.ceil(secondsLeft)} s`;
    }
  }

  setPaused(paused: boolean): void {
    this.overlay.classList.toggle('hidden', !paused);
    this.status.textContent = 'Pause : cliquer pour reprendre';
  }

  private restartAnimation(element: HTMLElement, classes: string): void {
    element.className = '';
    void element.offsetWidth;
    element.className = classes;
  }
}
