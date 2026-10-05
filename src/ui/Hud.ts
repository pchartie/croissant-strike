import type { CrosshairColor, CrosshairSize } from '../core/settings';

const KILLFEED_DURATION = 5000;
const KILLFEED_MAX = 5;
/** Blanc maximal d'une flash, et durée de son fondu final (secondes). */
const FLASH_MAX_OPACITY = 0.85;
const FLASH_FADE_TIME = 1.5;

const CROSSHAIR_COLORS: Record<CrosshairColor, string> = {
  green: '#4dff4d',
  white: '#ffffff',
  red: '#ff4d4d',
  cyan: '#4df6ff',
  yellow: '#ffe94d',
};

const CROSSHAIR_SIZES: Record<CrosshairSize, { len: number; gap: number; thick: number }> = {
  small: { len: 5, gap: 3, thick: 2 },
  medium: { len: 7, gap: 5, thick: 2 },
  large: { len: 11, gap: 7, thick: 3 },
};

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
  private readonly play = document.getElementById('play')!;
  private readonly crosshair = document.getElementById('crosshair')!;
  private readonly money = document.getElementById('money')!;
  private readonly scoreboard = document.getElementById('scoreboard')!;
  private readonly fps = document.getElementById('fps')!;
  private lastScoreboard = '';
  private readonly armor = document.getElementById('armor')!;
  private lastMoney = '';
  private lastArmor = '';
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
    this.play.addEventListener('click', onPlay);
  }

  /** Vitesse horizontale affichée en unités Source, comme cl_showpos. */
  setSpeed(units: number): void {
    const rounded = Math.round(units);
    if (rounded === this.lastSpeed) return;
    this.lastSpeed = rounded;
    this.speed.textContent = String(rounded);
  }

  /**
   * Munitions de l'arme en main. `reserve` null pour une grenade (juste le
   * nombre) ; `ammo` null aussi pour le couteau (juste le nom).
   */
  setAmmo(name: string, ammo: number | null, reserve: number | null): void {
    const key = `${name}|${ammo}|${reserve}`;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    this.weaponName.textContent = name;
    this.ammo.textContent = ammo === null ? '' : String(ammo);
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

  /**
   * Écran blanc d'une flash : `seconds` est l'aveuglement restant. Jamais tout à
   * fait blanc (on devine encore les formes), et il s'estompe sur la dernière
   * seconde et demie.
   */
  setFlash(seconds: number): void {
    this.flash.style.opacity = String(FLASH_MAX_OPACITY * Math.min(1, Math.max(0, seconds / FLASH_FADE_TIME)));
  }

  /** Voile gris quand on est dans un fumigène (0 à 1). */
  setSmoke(amount: number): void {
    this.smoke.style.opacity = String(Math.min(1, Math.max(0, amount)));
  }

  /** Couleur et taille du réticule. */
  setCrosshair(color: CrosshairColor, size: CrosshairSize): void {
    const { len, gap, thick } = CROSSHAIR_SIZES[size];
    const style = this.crosshair.style;
    style.setProperty('--color', CROSSHAIR_COLORS[color]);
    style.setProperty('--len', `${len}px`);
    style.setProperty('--gap', `${gap}px`);
    style.setProperty('--thick', `${thick}px`);
  }

  /** Argent (mode manches) et dernier gain récent ; null pour cacher (deathmatch). */
  setMoney(money: number | null, gain: { amount: number; reason: string } | null): void {
    const text = money === null ? '' : `${money} $${gain ? `|+${gain.amount} $ ${gain.reason}` : ''}`;
    if (text === this.lastMoney) return;
    this.lastMoney = text;
    const [amount, extra] = text.split('|');
    this.money.textContent = amount;
    if (extra) {
      const span = document.createElement('span');
      span.className = 'gain';
      span.textContent = extra;
      this.money.append(span);
    }
  }

  /** Tableau des scores (touche Tab), ou null pour le cacher. */
  setScoreboard(board: { title: string; rows: { name: string; kills: number; deaths: number; extra: string; me: boolean; dead: boolean }[] } | null): void {
    this.scoreboard.classList.toggle('hidden', board === null);
    if (!board) return;
    const escape = (text: string) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const rows = board.rows
      .map((r) => `<tr class="${r.me ? 'me' : ''} ${r.dead ? 'dead' : ''}"><td>${escape(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${escape(r.extra)}</td></tr>`)
      .join('');
    const html = `<h2>${escape(board.title)}</h2><table><tr><th>Joueur</th><th>Élim.</th><th>Morts</th><th></th></tr>${rows}</table>`;
    if (html === this.lastScoreboard) return;
    this.lastScoreboard = html;
    this.scoreboard.innerHTML = html;
  }

  /** Gilet pare-balles (et casque) affiché à côté de la santé. */
  setArmor(armor: number, helmet: boolean): void {
    const value = Math.ceil(armor);
    const text = value > 0 ? `${helmet ? 'Gilet + casque' : 'Gilet'} ${value}` : '';
    if (text === this.lastArmor) return;
    this.lastArmor = text;
    this.armor.textContent = text;
  }

  setFps(fps: number): void {
    this.fps.textContent = `${fps} FPS`;
  }

  setFpsVisible(visible: boolean): void {
    this.fps.style.display = visible ? '' : 'none';
  }

  setSpeedVisible(visible: boolean): void {
    this.speed.style.display = visible ? '' : 'none';
  }

  setPaused(paused: boolean): void {
    this.overlay.classList.toggle('hidden', !paused);
    if (!paused) this.play.textContent = 'Reprendre';
  }

  private restartAnimation(element: HTMLElement, classes: string): void {
    element.className = '';
    void element.offsetWidth;
    element.className = classes;
  }
}
