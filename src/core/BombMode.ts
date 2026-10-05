import * as THREE from 'three';
import type { Bot } from '../bots/Bot';
import type { BotManager } from '../bots/BotManager';
import { BOMB } from '../config';
import type { Player } from '../player/Player';
import { BOMB_SITES, type BombSite } from '../world/Level';

/** Où en est la bombe pendant une manche. `off` : pas de bombe (autres modes). */
export type BombState = 'off' | 'carried' | 'dropped' | 'planted' | 'exploded' | 'defused';
/** Le joueur, ou un bot. */
export type Carrier = 'player' | Bot;

export interface BombHooks {
  planted(site: BombSite, by: Carrier): void;
  exploded(position: THREE.Vector3): void;
  defused(by: Bot): void;
  /** Bip de la bombe posée, de plus en plus rapide. */
  beep(position: THREE.Vector3): void;
  pickedUp(by: Carrier): void;
}

/** Les objectifs des bots sont recalculés à ce rythme. */
const ASSIGN_INTERVAL = 0.5;
/** Vitesse en dessous de laquelle on est « immobile » (pour poser ou désamorcer). */
const STILL_SPEED = 0.5;
/** Regard vers le sud, d'où arrive l'équipe du joueur. */
const FACING_SOUTH = Math.PI;

/**
 * Mode bombe, comme de_dust : l'équipe du joueur (au sud) doit poser la bombe
 * sur le site A ou B ; les ennemis défendent les sites puis tentent de la
 * désamorcer. Si le joueur meurt avec la bombe, un coéquipier va la ramasser.
 */
export class BombMode {
  state: BombState = 'off';
  carrier: Carrier | null = null;
  /** Site où la bombe est posée. */
  site: BombSite | null = null;
  /** Position de la bombe au sol (tombée ou posée). */
  readonly position = new THREE.Vector3();
  /** Compte à rebours une fois posée. */
  timeLeft = 0;
  /** Progression de la pose et du désamorçage, de 0 à 1. */
  plantProgress = 0;
  defuseProgress = 0;
  defuser: Bot | null = null;

  /** Site visé par l'équipe du joueur cette manche (là où vont ses coéquipiers). */
  private target: BombSite = BOMB_SITES[0];
  private assignTimer = 0;
  private beepTimer = 0;
  private blink = 0;
  private readonly model: THREE.Group;
  private readonly led: THREE.Mesh;

  constructor(
    scene: THREE.Scene,
    private readonly player: Player,
    private readonly bots: BotManager,
    private readonly hooks: BombHooks,
  ) {
    ({ model: this.model, led: this.led } = buildBomb());
    this.model.visible = false;
    scene.add(this.model);
    for (const site of BOMB_SITES) scene.add(siteMarker(site));
  }

  get active(): boolean {
    return this.state !== 'off';
  }

  get planted(): boolean {
    return this.state === 'planted';
  }

  get playerCarrying(): boolean {
    return this.state === 'carried' && this.carrier === 'player';
  }

  /** Site sous ces pieds, s'il y en a un. */
  siteAt(feet: THREE.Vector3): BombSite | null {
    return BOMB_SITES.find((site) => site.zone.containsPoint(feet)) ?? null;
  }

  /** Début de manche : le joueur a la bombe, ses coéquipiers partent vers un site, les ennemis gardent les deux. */
  startRound(): void {
    this.state = 'carried';
    this.carrier = 'player';
    this.site = null;
    this.defuser = null;
    this.plantProgress = this.defuseProgress = 0;
    this.timeLeft = BOMB.timer;
    this.model.visible = false;
    this.target = BOMB_SITES[Math.floor(Math.random() * BOMB_SITES.length)];
    this.assignTimer = 0;
  }

  /** Quitte le mode bombe : plus de bombe, les bots reprennent leur patrouille. */
  stop(): void {
    this.state = 'off';
    this.carrier = null;
    this.model.visible = false;
    for (const bot of this.bots.bots) bot.setObjective(null);
  }

  /** `planting` : le joueur maintient la touche pour poser. */
  update(dt: number, planting: boolean): void {
    if (this.state === 'off') return;
    this.assignTimer -= dt;
    if (this.assignTimer <= 0) {
      this.assignTimer = ASSIGN_INTERVAL;
      this.assignObjectives();
    }
    switch (this.state) {
      case 'carried':
        this.updateCarried(dt, planting);
        break;
      case 'dropped':
        this.updateDropped();
        break;
      case 'planted':
        this.updatePlanted(dt);
        break;
    }
  }

  private updateCarried(dt: number, planting: boolean): void {
    const carrier = this.carrier!;
    const body = carrier === 'player' ? this.player : carrier.body;
    if (!(carrier === 'player' ? this.player.alive : carrier.alive)) {
      this.drop(body.position);
      return;
    }
    const site = this.siteAt(body.position);
    // Un coéquipier qui vient d'entrer sur un site s'y arrête tout de suite pour poser.
    if (site && carrier !== 'player' && !carrier.atObjective()) this.assignObjectives();
    // Le joueur maintient la touche ; un coéquipier pose dès qu'il est sur le site et à l'abri du combat.
    const wants = carrier === 'player' ? planting : !carrier.fighting;
    if (site && wants && body.onGround && body.horizontalSpeed < STILL_SPEED) {
      this.plantProgress += dt / BOMB.plantTime;
      if (this.plantProgress >= 1) this.plant(site, body.position, carrier);
    } else {
      this.plantProgress = 0;
    }
  }

  private updateDropped(): void {
    const near = (feet: THREE.Vector3) =>
      Math.hypot(feet.x - this.position.x, feet.z - this.position.z) < BOMB.pickupRange && Math.abs(feet.y - this.position.y) < 1.5;
    let taker: Carrier | null = null;
    if (this.player.alive && near(this.player.position)) taker = 'player';
    else taker = this.bots.allies.find((bot) => bot.alive && near(bot.body.position)) ?? null;
    if (!taker) return;
    this.state = 'carried';
    this.carrier = taker;
    this.model.visible = false;
    this.assignObjectives();
    this.hooks.pickedUp(taker);
  }

  private updatePlanted(dt: number): void {
    this.timeLeft -= dt;
    // Bips de plus en plus rapides : une par seconde au début, presque continus à la fin.
    this.beepTimer -= dt;
    if (this.beepTimer <= 0) {
      this.beepTimer = 0.1 + 0.9 * Math.max(this.timeLeft / BOMB.timer, 0);
      this.blink = 0.08;
      this.hooks.beep(this.position);
    }
    this.blink -= dt;
    this.led.visible = this.blink > 0;

    if (this.timeLeft <= 0) {
      this.state = 'exploded';
      this.model.visible = false;
      this.hooks.exploded(this.position);
      return;
    }

    // Désamorçage : un ennemi accroupi sur la bombe, sans combattre ; tout est à refaire s'il s'interrompt.
    const close = (bot: Bot) => bot.alive && !bot.fighting && bot.body.horizontalSpeed < STILL_SPEED && this.distance(bot.body.position) < BOMB.pickupRange + 0.2;
    if (!this.defuser || !close(this.defuser)) {
      this.defuser = this.bots.enemies.find(close) ?? null;
      this.defuseProgress = 0;
    }
    if (!this.defuser) return;
    this.defuseProgress += dt / BOMB.defuseTime;
    if (this.defuseProgress >= 1 && this.timeLeft > 0) {
      this.state = 'defused';
      this.led.visible = false;
      this.hooks.defused(this.defuser);
    }
  }

  private plant(site: BombSite, feet: THREE.Vector3, by: Carrier): void {
    this.state = 'planted';
    this.site = site;
    this.carrier = null;
    this.plantProgress = 0;
    this.timeLeft = BOMB.timer;
    this.beepTimer = 0;
    this.place(feet);
    this.assignObjectives();
    this.hooks.planted(site, by);
  }

  private drop(feet: THREE.Vector3): void {
    this.state = 'dropped';
    this.carrier = null;
    this.plantProgress = 0;
    this.place(feet);
    this.led.visible = false;
    this.assignObjectives();
  }

  private place(feet: THREE.Vector3): void {
    this.position.copy(feet);
    this.model.position.copy(feet);
    this.model.rotation.y = Math.random() * Math.PI * 2;
    this.model.visible = true;
  }

  private distance(feet: THREE.Vector3): number {
    return Math.hypot(feet.x - this.position.x, feet.z - this.position.z) + Math.max(0, Math.abs(feet.y - this.position.y) - 0.5);
  }

  /**
   * Où va chaque bot : avant la pose, l'équipe du joueur fonce vers le site
   * visé (le plus proche va ramasser la bombe tombée) et les ennemis gardent
   * les deux sites ; après la pose, tout le monde converge vers la bombe.
   */
  private assignObjectives(): void {
    const allies = this.bots.allies.filter((bot) => bot.alive);
    const enemies = this.bots.enemies.filter((bot) => bot.alive);
    if (this.state === 'planted') {
      for (const bot of enemies) bot.setObjective(this.position);
      allies.forEach((bot, i) => bot.setObjective(around(this.position, i, 3), FACING_SOUTH));
      return;
    }
    if (this.state !== 'carried' && this.state !== 'dropped') {
      for (const bot of [...allies, ...enemies]) bot.setObjective(null);
      return;
    }

    const fetcher = this.state === 'dropped' ? nearest(allies, this.position) : null;
    allies.forEach((bot, i) => {
      if (bot === fetcher) bot.setObjective(this.position);
      // Le porteur pose là où il entre dans un site (le centre peut être occupé par un défenseur).
      else if (bot === this.carrier) bot.setObjective(this.siteAt(bot.body.position) ? bot.body.position : this.target.center);
      else bot.setObjective(around(this.target.center, i, 2.5));
    });
    // Les défenseurs se répartissent entre A et B, tournés vers les entrées.
    enemies.forEach((bot, i) => {
      const site = BOMB_SITES[i % BOMB_SITES.length];
      bot.setObjective(around(site.center, Math.floor(i / BOMB_SITES.length), 3), FACING_SOUTH);
    });
  }
}

/** Point `i` d'une petite ronde autour de `center` (le premier au centre). */
function around(center: THREE.Vector3, i: number, radius: number): THREE.Vector3 {
  if (i === 0) return center;
  const angle = i * 2.4;
  return new THREE.Vector3(center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius);
}

function nearest(bots: Bot[], point: THREE.Vector3): Bot | null {
  let best: Bot | null = null;
  for (const bot of bots) {
    if (!best || bot.body.position.distanceTo(point) < best.body.position.distanceTo(point)) best = bot;
  }
  return best;
}

/** La bombe : un pain de C4 kaki, son boîtier et une diode rouge qui clignote. */
function buildBomb(): { model: THREE.Group; led: THREE.Mesh } {
  const model = new THREE.Group();
  const box = (size: [number, number, number], position: [number, number, number], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    model.add(mesh);
    return mesh;
  };
  box([0.34, 0.09, 0.22], [0, 0.045, 0], new THREE.MeshStandardMaterial({ color: 0x5b5a3c, roughness: 0.8 }));
  box([0.14, 0.04, 0.12], [-0.05, 0.11, 0], new THREE.MeshStandardMaterial({ color: 0x1d1f1c, roughness: 0.5 }));
  box([0.08, 0.005, 0.05], [-0.05, 0.132, -0.02], new THREE.MeshBasicMaterial({ color: 0x7fd36a }));
  const led = box([0.025, 0.025, 0.025], [0.06, 0.12, 0.05], new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  led.visible = false;
  return { model, led };
}

/** Grande lettre peinte au sol du site, comme les marquages de de_dust. */
function siteMarker(site: BombSite): THREE.Mesh {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(176, 38, 24, 0.85)';
  ctx.font = `bold ${size * 0.8}px Impact, Arial Black, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(site.name, size / 2, size / 2 + size * 0.04);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  marker.rotation.x = -Math.PI / 2;
  // Lisible depuis le sud, d'où l'on arrive.
  marker.position.copy(site.marker).setY(site.marker.y + 0.01);
  marker.receiveShadow = true;
  return marker;
}
