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

export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  me: boolean;
  dead: boolean;
}

interface ScoreTeam {
  name: string;
  side: 'ally' | 'enemy';
  score: number;
  rows: ScoreRow[];
}

interface Scoreboard {
  title: string;
  info: string;
  teams: ScoreTeam[];
  /** Ton bilan, en HTML (valeurs en gras). */
  stats: string[];
}

const SKULL =
  '<svg viewBox="0 0 16 16" aria-label="Mort"><path fill="currentColor" d="M8 1C4.4 1 2 3.4 2 6.6c0 1.9.9 3.3 2.2 4.1V13c0 .6.4 1 1 1h.8v-1.5h1.2V14h1.6v-1.5h1.2V14h.8c.6 0 1-.4 1-1v-2.3C13.1 9.9 14 8.5 14 6.6 14 3.4 11.6 1 8 1Zm-2.6 8.2a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5.2 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>';

const escape = (text: string) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

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
  private readonly scope = document.getElementById('scope-overlay')!;
  private lastScope = '';
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

  /**
   * Sniper en main : pas de réticule (tir au jugé, comme dans CS) ; lunette en place, le cercle noir et
   * ses fils. `null` : autre arme, réticule normal.
   */
  setScope(scoped: boolean | null): void {
    const key = String(scoped);
    if (key === this.lastScope) return;
    this.lastScope = key;
    this.crosshair.style.visibility = scoped === null ? '' : 'hidden';
    this.scope.classList.toggle('hidden', scoped !== true);
  }

  /** Argent (mode manches) et dernier gain récent ; null pour cacher (deathmatch). */
  setMoney(money: number | null, gain: { amount: number; reason: string } | null): void {
    const text = money === null ? '' : `${money} $${gain ? `|${gain.amount > 0 ? '+' : '−'}${Math.abs(gain.amount)} $ ${gain.reason}` : ''}`;
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
  /** Tableau des scores (null pour le cacher) : un bloc par camp, ton bilan en bas. */
  setScoreboard(board: Scoreboard | null): void {
    this.scoreboard.classList.toggle('hidden', board === null);
    if (!board) return;
    const ratio = (r: ScoreRow) => (r.kills / Math.max(r.deaths, 1)).toFixed(2);
    const diff = (r: ScoreRow) => {
      const value = r.kills - r.deaths;
      return `<td class="${value > 0 ? 'up' : value < 0 ? 'down' : ''}">${value > 0 ? '+' : ''}${value}</td>`;
    };
    const line = (r: ScoreRow) =>
      `<tr class="${r.me ? 'me' : ''} ${r.dead ? 'dead' : ''}">` +
      `<td class="player">${r.dead ? `<span class="skull">${SKULL}</span>` : ''}${escape(r.name)}</td>` +
      `<td>${r.kills}</td><td>${r.deaths}</td>${diff(r)}<td>${ratio(r)}</td></tr>`;
    const team = (t: ScoreTeam) => {
      const alive = t.rows.filter((r) => !r.dead).length;
      return (
        `<section class="team ${t.side}">` +
        `<header><span class="team-score">${t.score}</span><span class="team-name">${escape(t.name)}</span>` +
        `<span class="team-alive">${alive}/${t.rows.length} en vie</span></header>` +
        `<table><thead><tr><th class="player">Joueur</th><th>É</th><th>M</th><th>±</th><th>Ratio</th></tr></thead>` +
        `<tbody>${t.rows.map(line).join('')}</tbody></table></section>`
      );
    };
    const html =
      `<div class="board-head"><h2>${escape(board.title)}</h2>${board.info ? `<span>${escape(board.info)}</span>` : ''}</div>` +
      board.teams.map(team).join('') +
      `<footer>${board.stats.map((s) => `<span>${s}</span>`).join('')}</footer>`;
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
