import type { Settings } from '../core/settings';

const KILLFEED_DURATION = 5000;
const KILLFEED_MAX = 5;

export class Hud {
  private readonly speed = document.getElementById('speed')!;
  private readonly weaponName = document.getElementById('weapon-name')!;
  private readonly ammo = document.getElementById('ammo-count')!;
  private readonly reserve = document.getElementById('ammo-reserve')!;
  private readonly separator = document.querySelector<HTMLElement>('#ammo .sep')!;
  private readonly health = document.getElementById('health-value')!;
  private readonly score = document.getElementById('score')!;
  private readonly killfeed = document.getElementById('killfeed')!;
  private readonly hitmarker = document.getElementById('hitmarker')!;
  private readonly damage = document.getElementById('damage')!;
  private readonly death = document.getElementById('death')!;
  private readonly deathText = document.getElementById('death-text')!;
  private readonly overlay = document.getElementById('overlay')!;
  private readonly status = document.getElementById('overlay-status')!;
  private readonly grenades = document.getElementById('grenades')!;
  private readonly round = document.getElementById('round')!;
  private readonly roundScore = document.getElementById('round-score')!;
  private readonly roundTimer = document.getElementById('round-timer')!;
  private readonly roundAlive = document.getElementById('round-alive')!;
  private readonly banner = document.getElementById('banner')!;
  private readonly bannerTitle = document.getElementById('banner-title')!;
  private readonly bannerText = document.getElementById('banner-text')!;
  private readonly flash = document.getElementById('flash-overlay')!;
  private readonly smoke = document.getElementById('smoke-overlay')!;
  private lastGrenades = '';
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

  /** Munitions de l'arme en main ; `reserve` null pour une grenade (juste le nombre). */
  setAmmo(name: string, ammo: number, reserve: number | null): void {
    const key = `${name}|${ammo}|${reserve}`;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    this.weaponName.textContent = name;
    this.ammo.textContent = String(ammo);
    this.ammo.classList.toggle('low', ammo === 0);
    this.reserve.textContent = reserve === null ? '' : String(reserve);
    this.separator.style.display = reserve === null ? 'none' : '';
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

  /** Affiche l'écran de mort, ou le cache si `message` est null. */
  setDeath(killer: string | null, message: string | null): void {
    this.death.classList.toggle('hidden', message === null);
    if (message !== null) this.deathText.textContent = `Tué par ${killer} · ${message}`;
  }

  /** Grenades restantes, celle en main en surbrillance. */
  setGrenades(grenades: { label: string; count: number; current: boolean }[]): void {
    const key = grenades.map((g) => `${g.label}${g.count}${g.current}`).join('|');
    if (key === this.lastGrenades) return;
    this.lastGrenades = key;
    this.grenades.replaceChildren(
      ...grenades
        .filter((g) => g.count > 0)
        .map((g) => {
          const span = document.createElement('span');
          span.textContent = g.count > 1 ? `${g.label} ×${g.count}` : g.label;
          if (g.current) span.className = 'current';
          return span;
        }),
    );
  }

  /** Score, chrono et bots en vie du mode manches ; null pour cacher (deathmatch). */
  setRound(round: { player: number; bots: number; time: number; alive: number } | null): void {
    this.round.classList.toggle('active', round !== null);
    this.score.style.display = round ? 'none' : '';
    if (!round) return;
    const seconds = Math.ceil(round.time);
    this.roundScore.textContent = `Toi ${round.player} – ${round.bots} Bots`;
    this.roundTimer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    this.roundTimer.classList.toggle('urgent', seconds <= 10);
    this.roundAlive.textContent = `${round.alive} bot${round.alive > 1 ? 's' : ''} en vie`;
  }

  /** Grand message au centre (début de manche, victoire…), ou null pour le cacher. */
  setBanner(banner: { title: string; text: string; tone?: 'win' | 'loss' } | null): void {
    this.banner.classList.toggle('hidden', banner === null);
    if (!banner) return;
    this.bannerTitle.textContent = banner.title;
    this.bannerTitle.className = banner.tone ?? '';
    this.bannerText.textContent = banner.text;
  }

  /** Écran blanc d'une flash (0 à 1). */
  setFlash(amount: number): void {
    this.flash.style.opacity = String(Math.min(1, Math.max(0, amount)));
  }

  /** Voile gris quand on est dans un fumigène (0 à 1). */
  setSmoke(amount: number): void {
    this.smoke.style.opacity = String(Math.min(1, Math.max(0, amount)));
  }

  /** Boutons de réglage dans le menu de pause. */
  bindSettings(settings: Settings, onChange: (settings: Settings) => void): void {
    const bots = document.getElementById('setting-bots') as HTMLButtonElement;
    const aggressive = document.getElementById('setting-aggressive') as HTMLButtonElement;
    const mode = document.getElementById('setting-mode') as HTMLButtonElement;

    const render = () => {
      setToggle(bots, 'Bots', settings.botsEnabled ? 'activés' : 'désactivés', settings.botsEnabled);
      setToggle(aggressive, 'Comportement', settings.botsAggressive ? 'agressifs' : 'passifs', settings.botsAggressive);
      setToggle(mode, 'Mode', settings.mode === 'rounds' ? 'manches' : 'deathmatch', true);
      aggressive.disabled = !settings.botsEnabled;
    };
    const change = (apply: () => void) => (event: MouseEvent) => {
      // Sinon le clic traverse jusqu'au menu et lance la partie.
      event.stopPropagation();
      apply();
      render();
      onChange(settings);
    };

    bots.addEventListener('click', change(() => (settings.botsEnabled = !settings.botsEnabled)));
    aggressive.addEventListener('click', change(() => (settings.botsAggressive = !settings.botsAggressive)));
    mode.addEventListener('click', change(() => (settings.mode = settings.mode === 'rounds' ? 'deathmatch' : 'rounds')));
    render();
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

function setToggle(button: HTMLButtonElement, label: string, value: string, on: boolean): void {
  const name = document.createElement('span');
  name.textContent = label;
  const state = document.createElement('span');
  state.className = `value ${on ? 'on' : 'off'}`;
  state.textContent = value;
  button.replaceChildren(name, state);
}
