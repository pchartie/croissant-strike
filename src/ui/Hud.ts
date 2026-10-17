import type { CrosshairColor, CrosshairSize } from '../core/settings';
import { styleCrosshair } from './crosshair';
import { HUD_ICONS } from './hudIcons';
import { shopIcon } from './shopIcons';
import { weaponIcon } from './weaponIcons';

const KILLFEED_DURATION = 5000;
const KILLFEED_MAX = 5;

/** Blanc maximal d'une flash, et durée de son fondu final (secondes). */
const FLASH_MAX_OPACITY = 0.85;
const FLASH_FADE_TIME = 1.5;

export class Hud {
  private readonly weaponName = document.getElementById('weapon-name')!;
  private readonly ammo = document.getElementById('ammo-count')!;
  private readonly reserve = document.getElementById('ammo-reserve')!;
  private readonly separator = document.querySelector<HTMLElement>('#ammo .sep')!;
  private readonly health = document.getElementById('health-value')!;
  private readonly healthBar = document.getElementById('health-bar')!;
  private readonly healthPanel = document.getElementById('health')!;
  private readonly armorValue = document.getElementById('armor-value')!;
  private readonly armorBar = document.getElementById('armor-bar')!;
  private readonly armorIcon = document.getElementById('armor-icon') as HTMLImageElement;
  /** Camp de chaque nom, pour colorer le fil des éliminations (coéquipiers sable, ennemis bleus). */
  private teamOf: (name: string) => 'ally' | 'enemy' = () => 'enemy';
  private readonly score = document.getElementById('score')!;
  private readonly killfeed = document.getElementById('killfeed')!;
  private readonly hitmarker = document.getElementById('hitmarker')!;
  private readonly damage = document.getElementById('damage')!;
  private readonly death = document.getElementById('death')!;
  private readonly deathText = document.getElementById('death-text')!;
  private readonly overlay = document.getElementById('overlay')!;
  private readonly play = document.getElementById('play')!;
  private readonly resume = document.getElementById('resume')!;
  /** Jeu en pause (souris libérée), et depuis quand : l'Échap qui vient de libérer la souris ne compte pas. */
  private paused = true;
  private pausedAt = 0;
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
  private lastAmmo = '';
  private lastHealth = -1;

  constructor(onPlay: () => void) {
    this.play.addEventListener('click', onPlay);
    (document.getElementById('health-icon') as HTMLImageElement).src = HUD_ICONS.health;
    this.armorIcon.src = HUD_ICONS.armor;
    this.resume.addEventListener('click', onPlay);
    // Échap ouvre ou ferme le menu pendant la pause. Le navigateur ne laisse pas reprendre la
    // souris sur une touche : menu fermé, un clic n'importe où relance la partie.
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'Escape' || !this.paused || performance.now() - this.pausedAt < 400) return;
      this.showMenu(this.overlay.classList.contains('hidden'));
    });
  }

  private showMenu(open: boolean): void {
    this.overlay.classList.toggle('hidden', !open);
    this.resume.classList.toggle('hidden', open || !this.paused);
  }

  /**
   * Munitions de l'arme en main. `reserve` null pour une grenade (juste le
   * nombre) ; `ammo` null aussi pour le couteau (juste le nom).
   */
  setAmmo(name: string, ammo: number | null, reserve: number | null): void {
    // Silhouette de l'arme si elle existe (armes à feu), sinon son nom (couteau, grenades).
    const icon = itemIcon(name);
    const key = `${name}|${ammo}|${reserve}|${icon ?? ''}`;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    if (icon) this.weaponName.replaceChildren(iconImage(icon, name));
    else this.weaponName.textContent = name;
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
    this.healthBar.style.width = `${Math.min(value, 100)}%`;
    this.healthPanel.classList.toggle('low', value <= 25);
  }

  setScore(kills: number, deaths: number): void {
    this.score.innerHTML =
      `<span class="stat" title="Éliminations"><img src="${HUD_ICONS.kills}" alt="Éliminations">${kills}</span>` +
      `<span class="stat" title="Morts"><img src="${HUD_ICONS.deaths}" alt="Morts">${deaths}</span>`;
  }

  /** Petite croix autour du réticule quand une balle touche un bot. */
  showHitmarker(headshot: boolean): void {
    this.restartAnimation(this.hitmarker, headshot ? 'show head' : 'show');
  }

  /** Bords de l'écran qui rougissent quand le joueur est touché. */
  showDamage(): void {
    this.restartAnimation(this.damage, 'show');
  }

  /** Fonction qui donne le camp d'un nom (joueur et coéquipiers : 'ally'). */
  setTeamResolver(teamOf: (name: string) => 'ally' | 'enemy'): void {
    this.teamOf = teamOf;
  }

  /** `mine` : tué par le joueur (encadré rouge) ; `me` : le joueur est la victime. */
  addKill(killer: string, victim: string, weapon: string, headshot: boolean, side: { mine?: boolean; me?: boolean } = {}): void {
    const entry = document.createElement('div');
    entry.className = 'kill';
    if (side.mine) entry.classList.add('mine');
    if (side.me) entry.classList.add('me');
    const name = (text: string) => Object.assign(document.createElement('span'), { textContent: text, className: `name ${this.teamOf(text)}` });
    // Comme dans CS : tueur, silhouette de l'arme, tête si headshot, « dans le dos » au couteau, victime.
    const backstab = weapon.endsWith('dans le dos');
    const base = backstab ? weapon.split(' · ')[0] : weapon;
    const icon = itemIcon(base);
    entry.append(name(killer), icon ? iconImage(icon, base) : Object.assign(document.createElement('span'), { textContent: base, className: 'weapon' }));
    if (headshot) entry.append(iconImage(HUD_ICONS.headshot, 'headshot', 'kill-flag headshot'));
    if (backstab) entry.append(iconImage(HUD_ICONS.backstab, 'dans le dos', 'kill-flag'));
    entry.append(name(victim));
    this.killfeed.prepend(entry);
    while (this.killfeed.children.length > KILLFEED_MAX) this.killfeed.lastElementChild!.remove();
    setTimeout(() => entry.remove(), KILLFEED_DURATION);
  }

  /** Affiche l'écran de mort, ou le cache si `message` est null. */
  setDeath(killer: string | null, message: string | null): void {
    this.death.classList.toggle('hidden', message === null);
    if (message !== null) this.deathText.textContent = `Tué par ${killer} · ${message}`;
  }

  /** Grenades restantes (leurs silhouettes), celle en main en surbrillance. */
  setGrenades(grenades: { label: string; icon: string; count: number; current: boolean }[]): void {
    const key = grenades.map((g) => `${g.label}${g.count}${g.current}`).join('|');
    if (key === this.lastGrenades) return;
    this.lastGrenades = key;
    this.grenades.replaceChildren(
      ...grenades
        .filter((g) => g.count > 0)
        .map((g) => {
          const span = document.createElement('span');
          span.append(iconImage(g.icon, g.label, 'grenade-icon'));
          if (g.count > 1) span.append(`×${g.count}`);
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
    styleCrosshair(this.crosshair, color, size);
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
  setScoreboard(
    board: { title: string; rows: { name: string; kills: number; deaths: number; extra: string; me: boolean; dead: boolean; ally: boolean }[] } | null,
  ): void {
    this.scoreboard.classList.toggle('hidden', board === null);
    if (!board) return;
    const escape = (text: string) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const rows = board.rows
      .map((r) => `<tr class="${r.me ? 'me' : r.ally ? 'ally' : ''} ${r.dead ? 'dead' : ''}"><td>${escape(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${escape(r.extra)}</td></tr>`)
      .join('');
    const html = `<h2>${escape(board.title)}</h2><table><tr><th>Joueur</th><th>Élim.</th><th>Morts</th><th></th></tr>${rows}</table>`;
    if (html === this.lastScoreboard) return;
    this.lastScoreboard = html;
    this.scoreboard.innerHTML = html;
  }

  /** Gilet pare-balles (et casque) à côté de la santé : l'icône devient un casque quand on en a un. */
  setArmor(armor: number, helmet: boolean): void {
    const value = Math.max(0, Math.ceil(armor));
    const text = `${value}|${helmet}`;
    if (text === this.lastArmor) return;
    this.lastArmor = text;
    this.armorValue.textContent = String(value);
    this.armorBar.style.width = `${Math.min(value, 100)}%`;
    this.armorIcon.src = helmet ? HUD_ICONS.helmet : HUD_ICONS.armor;
    this.armorIcon.alt = helmet ? 'Gilet + casque' : 'Gilet';
    this.armor.classList.toggle('empty', value === 0);
  }

  /** Bandeau « bots figés » (inspection), avec la touche pour les relancer. */
  setFrozen(frozen: boolean): void {
    document.getElementById('frozen')!.classList.toggle('hidden', !frozen);
  }

  setFps(fps: number): void {
    this.fps.textContent = `${fps} FPS`;
  }

  setFpsVisible(visible: boolean): void {
    this.fps.style.display = visible ? '' : 'none';
  }

  /** Carte choisie dans le menu mais pas encore chargée : le bouton la charge (null : Jouer / Reprendre). */
  setPendingMap(label: string | null): void {
    this.pendingMap = label;
    this.updatePlayLabel();
  }

  private pendingMap: string | null = null;
  private started = false;

  private updatePlayLabel(): void {
    this.play.textContent = this.pendingMap ? `Charger ${this.pendingMap}` : this.started ? 'Reprendre' : 'Jouer';
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.pausedAt = performance.now();
    this.showMenu(paused);
    if (!paused) {
      this.started = true;
      this.updatePlayLabel();
    }
  }

  private restartAnimation(element: HTMLElement, classes: string): void {
    element.className = '';
    void element.offsetWidth;
    element.className = classes;
  }
}

/** Image d'une arme (silhouette blanche), avec son nom en texte de remplacement. */
function iconImage(src: string, name: string, className = 'weapon-icon'): HTMLImageElement {
  return Object.assign(document.createElement('img'), { src, alt: name, title: name, className });
}

/** Silhouette d'une arme à feu, du couteau ou d'une grenade, d'après son nom ; null si aucune. */
function itemIcon(name: string): string | null {
  if (name === 'Couteau') return HUD_ICONS.knife;
  const grenade = { 'Grenade HE': 'he', Flash: 'flash', Fumigène: 'smoke', Molotov: 'molotov' } as const;
  if (name in grenade) return shopIcon(grenade[name as keyof typeof grenade]);
  return weaponIcon(name);
}
