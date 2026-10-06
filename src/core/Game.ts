import * as THREE from 'three';
import type { Bot } from '../bots/Bot';
import { BotManager, type BotShot } from '../bots/BotManager';
import { DAMAGE_MULTIPLIER, type HitPart } from '../bots/BotModel';
import { BOMB, CAMERA, ECONOMY, MOVE, PLAYER, TICK, UNIT } from '../config';
import { DECOY, GRENADE_ORDER, GRENADES, HE, MOLOTOV } from '../grenades/definitions';
import { throwVelocity } from '../grenades/ballistics';
import { flashDuration } from '../grenades/flashbang';
import { GrenadeSystem } from '../grenades/GrenadeSystem';
import { Player } from '../player/Player';
import { BuyMenu } from '../ui/BuyMenu';
import { Radar, type RadarMark } from '../ui/Radar';
import { Hud } from '../ui/Hud';
import { SettingsPanel } from '../ui/SettingsPanel';
import { Duel } from '../net/Duel';
import { RIFLE, type WeaponDef } from '../weapons/definitions';
import { Impacts } from '../weapons/Impacts';
import { loadRetroWeapons } from '../weapons/RetroWeapons';
import { Tracers } from '../weapons/Tracers';
import { ViewModel } from '../weapons/ViewModel';
import { WeaponSystem, type MeleeKind, type Shot } from '../weapons/WeaponSystem';
import { BOMB_SITES, buildLevel, LEVEL_BOUNDS, PLAYER_SPAWN, type BombSite } from '../world/Level';
import { NavGrid } from '../world/NavGrid';
import { loadSky } from '../world/sky';
import { surfaceOf, type Surface } from '../world/surfaces';
import { World } from '../world/World';
import { absorbDamage, BLAST_ARMOR_RATIO, type DamageZone } from './armor';
import { keyName } from './bindings';
import { BombMode, type Carrier } from './BombMode';
import { Audio } from './Audio';
import { Economy } from './Economy';
import { HELMET_UPGRADE_PRICE, SHOP_ITEMS, type ShopItem } from './shop';
import { Input } from './Input';
import { Rounds } from './Rounds';
import { loadSettings, saveSettings, type GameMode, type Settings } from './settings';

const MAX_FRAME_TIME = 0.1;
const MUZZLE_LIGHT_DURATION = 0.04;
const RESPAWN_DELAY = 3;
/** Distance à laquelle un son devient presque inaudible. */
const HEARING_DISTANCE = 60;
/** En deçà, un tir de bot utilise la prise de son rapprochée. */
const CLOSE_SHOT_DISTANCE = 10;
/** On n'entend pas « aïe » à chaque tick passé dans le feu. */
const HURT_SOUND_INTERVAL = 0.35;
/** 500 unités Source : distance de référence du « range modifier » des armes. */
const RANGE_UNIT = 500 * UNIT;
/** Prime d'élimination à la grenade (CS:GO). */
const GRENADE_KILL_REWARD = 300;
/** Durée d'affichage d'un gain d'argent (« +300 $ Élimination »). */
const GAIN_DISPLAY_MS = 2500;
/** Pas : bruit au-dessus de cette vitesse (on court ; en marchant ou accroupi, silence comme dans CS), tous les `STRIDE` mètres. */
const STEP_SPEED = 140 * UNIT;
const STRIDE = 2;
/** Distance au-delà de laquelle on n'entend plus les pas des bots, ni les impacts de balles. */
const FOOTSTEP_HEARING = 25;
const IMPACT_HEARING = 30;
/** Vitesse de chute au-delà de laquelle la réception fait du bruit. */
const LANDING_SPEED = 4;
const DOWN = new THREE.Vector3(0, -1, 0);
/** Radar : repérage des ennemis 10 fois par seconde ; un ennemi repéré reste affiché 1,5 s. */
const SPOT_INTERVAL_MS = 100;
const SPOT_MEMORY_MS = 1500;
/** Taille de la carte d'ombre du soleil selon la qualité choisie (0 = pas d'ombres). */
const SHADOW_MAP_SIZES = { off: 0, low: 1024, high: 4096 };
/** Coup dans le dos si le bot regarde à moins de ~65° de la direction opposée au joueur. */
const BACKSTAB_DOT = 0.4;

export class Game {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.05, 500);
  private readonly input: Input;
  private readonly world = new World(this.scene);
  private readonly player = new Player();
  private readonly hud: Hud;
  private readonly audio = new Audio();
  private readonly viewModel = new ViewModel();
  private readonly impacts = new Impacts(this.scene);
  private readonly tracers = new Tracers(this.scene);
  private readonly nav: NavGrid;
  private readonly weapons: WeaponSystem;
  private readonly grenades: GrenadeSystem;
  private readonly bots: BotManager;
  private readonly rounds: Rounds;
  private readonly bomb: BombMode;
  /** Partie en ligne en 1 contre 1 (sans bots ni grenades pour l'instant). */
  private readonly duel: Duel;
  /** Derniers réglages, pour revenir au jeu seul après une partie en ligne. */
  private settings!: Settings;
  /** Nom de la touche pour poser la bombe, pour la consigne à l'écran. */
  private useKey = 'E';
  private plantKeyTimer = 0;
  private mode: GameMode = 'deathmatch';
  private readonly economy = new Economy();
  private readonly buyMenu = new BuyMenu();

  /** Éclaire brièvement les alentours à chaque tir. */
  private readonly muzzleLight = new THREE.PointLight(0xffb060, 0, 8, 2);
  private muzzleLightTimer = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly forward = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly toSound = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  private kills = 0;
  /** Statistiques du joueur pour le tableau des scores et la fin de match. */
  private stats = { shots: 0, hits: 0, headshots: 0, damage: 0 };
  private deaths = 0;
  /** Temps restant avant de réapparaître (deathmatch), ou null. */
  private respawnTimer: number | null = null;
  private killer = '';
  /** Aveuglement restant après une flash, en secondes. */
  private flashTime = 0;
  private hurtCooldown = 0;
  private playerStride = 0;
  private remoteStride = 0;
  private readonly botStrides = new Map<Bot, number>();
  private readonly radar: Radar;
  private readonly sun: THREE.DirectionalLight;
  private fpsFrames = 0;
  private fpsTime = 0;
  private readonly spotted = new Map<Bot, number>();
  private lastSpotting = 0;
  private remoteSpotted = -Infinity;
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private wasOnGround = true;
  private fallSpeed = 0;

  private accumulator = 0;
  private lastTime = 0;

  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.input = new Input(this.renderer.domElement);
    this.hud = new Hud(() => {
      this.audio.unlock();
      this.input.requestLock();
    });
    this.input.onLockChange((locked) => this.hud.setPaused(!locked));

    this.sun = buildLevel(this.world, this.renderer.capabilities.getMaxAnisotropy());
    void loadSky(this.scene, [this.viewModel.scene]);
    this.scene.add(this.muzzleLight);
    this.player.spawn(PLAYER_SPAWN.position, PLAYER_SPAWN.yaw);

    this.nav = new NavGrid(this.world.colliders, LEVEL_BOUNDS, PLAYER.radius + 0.1, PLAYER_SPAWN.position);
    this.radar = new Radar(document.getElementById('radar') as HTMLCanvasElement, this.nav);
    this.bots = new BotManager(this.scene, this.world, this.nav, this.player, {
      shot: (shot) => this.onBotShot(shot),
      grenade: (bot, type, target) => this.onBotGrenade(bot, type, target),
    });

    this.weapons = new WeaponSystem(this.player, () => [...this.world.meshes, ...this.bots.hitboxes, ...(this.duel?.remote.hitboxes ?? [])], {
      fired: (def, shots) => this.onPlayerShot(def, shots),
      reloadStarted: (def, phase, duration) => {
        this.viewModel.reload(def, phase, duration);
        this.audio.reload(def, phase, duration);
      },
      drawn: (def) => {
        this.grenades?.unequip();
        this.viewModel.show(def);
        this.audio.draw();
      },
      dryFired: () => this.audio.dryFire(),
      swung: (_def, kind) => {
        this.viewModel.swing(kind);
        this.audio.knifeSwing(kind === 'heavy');
        this.duel.sendSwing(kind === 'heavy');
      },
      struck: (def, kind, hit, direction, combo) => this.onKnifeStrike(def, kind, hit, direction, combo),
    });

    this.grenades = this.createGrenades();
    this.bots.setVisionBlocker((from, to) => this.grenades.blocksVision(from, to));
    this.bomb = this.createBomb();
    this.duel = this.createDuel();
    this.rounds = new Rounds({
      reset: (newMatch) => this.resetRound(newMatch),
      ended: (winner) => this.economy.roundEnded(winner === 'player'),
    });

    this.hud.setScore(0, 0);
    const settings = loadSettings();
    this.applySettings(settings);
    // Deathmatch dès le lancement : gilet et casque, comme à chaque réapparition.
    if (this.mode === 'deathmatch') {
      this.player.armor = 100;
      this.player.helmet = true;
    }
    new SettingsPanel(document.getElementById('settings')!, settings, (changed) => {
      this.applySettings(changed);
      saveSettings(changed);
    });
    void loadRetroWeapons().then((weapons) => {
      if (!weapons) return;
      this.viewModel.useAnimated(weapons.viewModels, this.weapons.current.def);
      this.bots.setWeaponModel(weapons.botRifle);
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  start(): void {
    this.renderer.setAnimationLoop((time) => this.frame(time / 1000));
  }

  private frame(time: number): void {
    const frameTime = Math.min(time - this.lastTime, MAX_FRAME_TIME);
    this.lastTime = time;
    // Images par seconde, moyennées sur une demi-seconde.
    this.fpsFrames++;
    this.fpsTime += frameTime;
    if (this.fpsTime >= 0.5) {
      this.hud.setFps(Math.round(this.fpsFrames / this.fpsTime));
      this.fpsFrames = this.fpsTime = 0;
    }

    // La souris est lue à chaque image (et pas à chaque tick) pour une visée sans latence.
    const mouse = this.input.consumeMouse();
    if (this.player.alive) this.player.look(mouse.dx, mouse.dy);

    // Physique à pas fixe, indépendante du nombre d'images par seconde.
    if (this.input.locked) {
      this.accumulator += frameTime;
      while (this.accumulator >= TICK) {
        this.tick();
        this.accumulator -= TICK;
      }
    }

    const alpha = this.accumulator / TICK;
    this.player.applyToCamera(this.camera, alpha, this.weapons.punch);
    if (!this.player.alive) {
      // Mort : la caméra tombe au sol et penche.
      this.camera.position.y -= this.player.eyeHeight - 0.3;
      this.camera.rotation.z = 0.4;
    }
    this.bots.render(alpha);
    this.duel.update(frameTime, this.weapons.current.def.id);
    this.updateEffects(frameTime, mouse);
    this.updateHud();
    this.updateRadar();

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.player.alive) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewModel.scene, this.viewModel.camera);
    }
  }

  private tick(): void {
    // Pendant le gel de début de manche, on peut regarder autour mais pas bouger ni tirer.
    const frozen = this.roundBased && this.rounds.frozen;

    // Le menu d'achat passe en premier : ses touches 1 à 0 ne doivent pas changer d'arme.
    this.updateBuyMenu();
    if (this.player.alive && !frozen) {
      this.player.update(TICK, this.input, [...this.world.colliders, ...this.bots.colliders, ...this.remoteColliders]);
      if (this.player.outOfMap) this.player.spawn(PLAYER_SPAWN.position, PLAYER_SPAWN.yaw);
      if (this.input.consumePress('grenades') && this.grenades.cycle()) {
        this.weapons.holster();
        this.viewModel.showGrenade(this.grenades.current!);
        this.audio.draw();
      }
      this.weapons.update(TICK, this.input);
      if (this.weapons.holstered) this.grenades.updateInput(TICK, this.input);
    } else if (this.respawnTimer !== null) {
      this.respawnTimer -= TICK;
      if (this.respawnTimer <= 0) this.respawn();
    }

    if (!frozen) this.bots.update(TICK);
    this.grenades.update(TICK);
    this.applyFire();
    this.updateFootsteps();
    if (this.mode === 'bomb' && this.rounds.current.phase === 'live') this.updateBomb();
    if (this.roundBased) this.rounds.update(TICK, this.player.alive, this.bots.aliveCount, this.bots.alliesAlive, this.bomb.planted);

    this.flashTime = Math.max(0, this.flashTime - TICK);
    this.hurtCooldown = Math.max(0, this.hurtCooldown - TICK);
    this.input.endTick();
  }

  // --- Dégâts ---

  /** Dégâts infligés au joueur, par un bot ou par une grenade (les siennes comprises). */
  /** Dégâts au joueur (`amount` brut : son gilet en arrête une partie selon la zone et l'arme). */
  private damagePlayer(amount: number, zone: DamageZone, armorRatio: number, attacker: string, weapon: string, headshot = false, killer?: Bot): void {
    if (!this.player.alive) return;
    const armored = this.player.armor > 0;
    this.player.health -= absorbDamage(this.player, amount, zone, armorRatio);
    if (zone !== 'fire') {
      // Comme dans CS:GO : la visée sursaute (moins avec un gilet) et on ralentit un instant.
      const punch = (armored ? 0.5 : 1) * Math.min(amount / 30, 1.5);
      this.weapons.punch.pitch += (0.025 + Math.random() * 0.02) * punch;
      this.weapons.punch.yaw += (Math.random() - 0.5) * 0.03 * punch;
      this.player.tag();
    }
    if (this.hurtCooldown === 0) {
      this.hud.showDamage();
      this.audio.hurt();
      this.hurtCooldown = HURT_SOUND_INTERVAL;
    }
    if (this.player.alive) return;

    this.deaths++;
    if (killer) killer.kills++;
    this.killer = attacker;
    this.hud.addKill(attacker, 'Toi', weapon, headshot);
    this.hud.setScore(this.kills, this.deaths);
    if (this.mode === 'deathmatch') this.respawnTimer = RESPAWN_DELAY;
  }

  /** Dégâts infligés à un bot par le joueur ; renvoie vrai s'il en meurt. */
  /** Dégâts du joueur à un bot (grenade, feu, couteau) ; renvoie vrai s'il en meurt. */
  private damageBot(bot: Bot, amount: number, zone: DamageZone, armorRatio: number, weapon: string, reward: number, headshot = false): boolean {
    const before = Math.max(bot.health, 0);
    const killed = this.bots.damageBot(bot, amount, zone, armorRatio);
    this.stats.damage += before - Math.max(bot.health, 0);
    if (killed) this.onBotKilled(bot, weapon, reward, headshot);
    return killed;
  }

  private onBotKilled(bot: Bot, weapon: string, reward: number, headshot: boolean): void {
    if (headshot) this.stats.headshots++;
    this.kills++;
    this.hud.addKill('Toi', bot.name, weapon, headshot);
    this.hud.setScore(this.kills, this.deaths);
    if (this.roundBased) this.economy.earn(reward, 'Élimination');
  }

  private resetStats(): void {
    this.kills = this.deaths = 0;
    this.stats = { shots: 0, hits: 0, headshots: 0, damage: 0 };
    this.bots.resetStats();
    this.hud.setScore(0, 0);
  }

  // --- Achat ---

  /** On achète partout en deathmatch ; en manches, pendant le gel et le début de manche. */
  private get canBuy(): boolean {
    if (!this.player.alive) return false;
    if (this.mode === 'deathmatch') return true;
    const { phase } = this.rounds.current;
    return phase === 'freeze' || (phase === 'live' && this.rounds.elapsed < ECONOMY.buyTime);
  }

  /** Secondes restantes pour acheter (manches), ou null (deathmatch). */
  private get buyTimeLeft(): number | null {
    if (this.mode === 'deathmatch') return null;
    const { phase, timeLeft } = this.rounds.current;
    return phase === 'freeze' ? timeLeft + ECONOMY.buyTime : Math.max(0, ECONOMY.buyTime - this.rounds.elapsed);
  }

  private updateBuyMenu(): void {
    const canBuy = this.canBuy;
    if (this.input.consumePress('buy') && canBuy) this.buyMenu.toggle();
    if (!this.buyMenu.open) return;
    if (!canBuy) {
      this.buyMenu.close();
      return;
    }
    for (const item of SHOP_ITEMS) if (this.input.consumeCode(item.code)) this.buy(item);
  }

  private priceOf(item: ShopItem): number {
    if (this.mode === 'deathmatch') return 0;
    // Casque seul si on a déjà un gilet neuf.
    if (item.kind === 'helmet' && this.player.armor >= 100 && !this.player.helmet) return HELMET_UPGRADE_PRICE;
    return item.price;
  }

  private itemState(item: ShopItem): 'ok' | 'expensive' | 'owned' {
    let owned: boolean;
    switch (item.kind) {
      case 'weapon':
        owned = this.weapons.primary?.def.id === item.weapon.id;
        break;
      case 'armor':
        owned = this.player.armor >= 100;
        break;
      case 'helmet':
        owned = this.player.armor >= 100 && this.player.helmet;
        break;
      case 'grenade':
        owned = !this.grenades.canGive(item.grenade);
        break;
    }
    if (owned) return 'owned';
    return this.roundBased && this.priceOf(item) > this.economy.money ? 'expensive' : 'ok';
  }

  private buy(item: ShopItem): void {
    const state = this.itemState(item);
    if (state === 'owned') {
      this.buyMenu.message = item.kind === 'grenade' ? 'Limite de grenades atteinte' : 'Déjà équipé';
      return;
    }
    if (item.kind === 'grenade' && this.duel.active) {
      this.buyMenu.message = 'Pas encore de grenades en ligne';
      return;
    }
    if (this.roundBased && !this.economy.spend(this.priceOf(item))) {
      this.buyMenu.message = "Pas assez d'argent";
      return;
    }
    switch (item.kind) {
      case 'weapon':
        this.weapons.setPrimary(item.weapon);
        break;
      case 'armor':
        this.player.armor = 100;
        break;
      case 'helmet':
        this.player.armor = 100;
        this.player.helmet = true;
        break;
      case 'grenade':
        this.grenades.give(item.grenade);
        break;
    }
    this.audio.draw();
    this.buyMenu.message = `${item.label} : acheté`;
  }

  /**
   * Explosion : dégâts à tous ceux qu'elle « voit » (les murs protègent), forts
   * au centre et qui baissent vite avec la distance, comme la HE de CS:GO.
   */
  private applyAreaDamage(center: THREE.Vector3, radius: number, maxDamage: number, weapon: string, thrower: Bot | null = null): void {
    const sigma = radius / 3;
    const origin = center.clone().setY(center.y + 0.1);
    const hits = (feet: THREE.Vector3, height: number) => {
      const body = feet.clone().setY(feet.y + height / 2);
      const distance = body.distanceTo(origin);
      if (distance > radius || !this.clearLine(origin, body)) return 0;
      return maxDamage * Math.exp(-(distance * distance) / (2 * sigma * sigma));
    };

    // Pas de tir ami : une grenade ne blesse que le camp adverse (et le joueur qui l'a lancée).
    const throwerTeam = thrower ? thrower.team : 'ally';
    for (const bot of this.bots.bots) {
      if (!bot.alive || bot.team === throwerTeam) continue;
      const damage = hits(bot.body.position, bot.body.height);
      if (damage < 1) continue;
      if (thrower) this.botHurtsBot(thrower, bot, damage, 'blast', BLAST_ARMOR_RATIO, weapon, false);
      else this.damageBot(bot, damage, 'blast', BLAST_ARMOR_RATIO, weapon, GRENADE_KILL_REWARD);
    }
    // Le joueur : touché par ses propres grenades et celles des ennemis, pas par celles de ses coéquipiers.
    if (this.player.alive && thrower?.team !== 'ally') {
      const damage = hits(this.player.position, this.player.height);
      if (damage >= 1) this.damagePlayer(damage, 'blast', BLAST_ARMOR_RATIO, thrower?.name ?? 'Toi', weapon, false, thrower ?? undefined);
    }
  }

  /** Feux de molotov : brûlent le joueur et les bots qui sont dedans. */
  private applyFire(): void {
    const burning = (feet: THREE.Vector3) => this.grenades.burning(feet);
    const damage = MOLOTOV.damagePerSecond * TICK;
    if (this.player.alive && burning(this.player.position)) this.damagePlayer(damage, 'fire', 1, 'Toi', GRENADES.molotov.name);
    // Le feu (toujours lancé par le joueur) fait fuir tout le monde mais ne blesse pas ses coéquipiers.
    this.bots.burn(
      (feet) => this.grenades.fireAt(feet),
      (bot) => bot.team === 'enemy' && this.damageBot(bot, damage, 'fire', 1, GRENADES.molotov.name, GRENADE_KILL_REWARD),
    );
  }

  // --- Tirs ---

  /** Un tir du joueur : une balle, ou les plombs d'un fusil à pompe (dégâts qui baissent avec la distance). */
  private onPlayerShot(def: WeaponDef, shots: Shot[]): void {
    this.viewModel.kick(def);
    this.audio.shot(def);
    this.muzzleLightTimer = MUZZLE_LIGHT_DURATION;
    this.bots.playerFired(this.player.position);

    // En ligne : l'adversaire voit le tir (son, traînées jusqu'au point d'arrivée de chaque balle).
    if (this.duel.active) {
      const eye = this.player.eyePosition(new THREE.Vector3());
      this.duel.sendShot(def, eye, shots.map(({ hit, direction }) => (hit ? hit.point : eye.clone().addScaledVector(direction, def.range))));
    }

    let touched = false;
    let headshotHit = false;
    let wallHits = 0;
    for (const { hit, direction } of shots) {
      if (!hit) continue;
      if (hit.object.userData.remote) {
        // On annonce la touche ; l'adversaire applique les dégâts avec son gilet.
        const part = hit.object.userData.part as HitPart;
        const falloff = Math.pow(def.rangeModifier ?? 1, hit.distance / RANGE_UNIT);
        const damage = def.damage * falloff * DAMAGE_MULTIPLIER[part];
        this.duel.sendHit(def, part, damage);
        this.stats.damage += Math.min(damage, 100);
        touched = true;
        headshotHit ||= part === 'head';
        this.impacts.addBlood(hit.point, direction, shots.length > 1 ? 4 : part === 'head' ? 18 : 10);
        continue;
      }
      if (!hit.object.userData.bot) {
        // Un seul bruit d'impact par tir (les plombs d'un fusil à pompe frappent ensemble).
        this.impactSound(this.impacts.add(hit), hit.point, wallHits++ === 0);
        continue;
      }
      const falloff = Math.pow(def.rangeModifier ?? 1, hit.distance / RANGE_UNIT);
      const healthBefore = Math.max((hit.object.userData.bot as Bot).health, 0);
      const { bot, part, killed } = this.bots.hit(hit.object, def.damage * falloff, def.armorRatio);
      this.stats.damage += healthBefore - Math.max(bot.health, 0);
      const headshot = part === 'head';
      touched = true;
      headshotHit ||= headshot;
      this.impacts.addBlood(hit.point, direction, shots.length > 1 ? 4 : headshot ? 18 : 10);
      if (killed) this.onBotKilled(bot, def.name, def.killReward, headshot);
    }
    this.stats.shots++;
    if (touched) {
      this.stats.hits++;
      this.hud.showHitmarker(headshotHit);
      this.audio.hit(headshotHit);
    }
  }

  /**
   * Coup de couteau qui arrive : dégâts de CS:GO (40 puis 25 en enchaînant au
   * clic gauche, 65 au clic droit), bien plus dans le dos.
   */
  private onKnifeStrike(def: WeaponDef, kind: MeleeKind, hit: THREE.Intersection | null, direction: THREE.Vector3, combo: boolean): void {
    if (!hit) return;
    const melee = def.melee!;
    if (hit.object.userData.remote) {
      const remote = this.duel.remote;
      const backstab = this.isBehind(remote.forward(this.forward), remote.position);
      const damage = backstab ? melee[kind].backstab : kind === 'light' && combo ? melee.light.followUp : melee[kind].damage;
      this.impacts.addBlood(hit.point, direction, backstab ? 20 : 12);
      this.hud.showHitmarker(backstab);
      this.audio.knifeHit();
      // Pas de ×4 à la tête au couteau, comme dans CS (la zone ne sert qu'au gilet).
      this.duel.sendHit(def, hit.object.userData.part as HitPart, damage, backstab ? `${def.name} · dans le dos` : undefined);
      return;
    }
    if (!hit.object.userData.bot) {
      this.impactSound(this.impacts.add(hit), hit.point, true);
      this.audio.knifeWall();
      return;
    }
    const bot = hit.object.userData.bot as Bot;
    const backstab = this.isBehind(bot.forward(this.forward), bot.body.position);
    const damage = backstab ? melee[kind].backstab : kind === 'light' && combo ? melee.light.followUp : melee[kind].damage;
    this.impacts.addBlood(hit.point, direction, backstab ? 20 : 12);
    this.hud.showHitmarker(backstab);
    this.audio.knifeHit();
    const zone = (hit.object.userData.part ?? 'body') as DamageZone;
    this.damageBot(bot, damage, zone, def.armorRatio, backstab ? `${def.name} · dans le dos` : def.name, def.killReward);
  }

  /** Vrai si le joueur est derrière sa cible (qui regarde vers `facing` et lui tourne le dos). */
  private isBehind(facing: THREE.Vector3, position: THREE.Vector3): boolean {
    facing.setY(0).normalize();
    const toTarget = this.toSound.subVectors(position, this.player.position).setY(0).normalize();
    return facing.dot(toTarget) > BACKSTAB_DOT;
  }

  private onBotShot(shot: BotShot): void {
    const { loudness, pan, distance } = this.hearing(shot.origin);
    this.audio.shot(RIFLE, { distant: distance > CLOSE_SHOT_DISTANCE, loudness: Math.min(loudness, 0.8), pan });
    this.tracers.add(shot.origin, shot.end);
    if (shot.worldHit) this.impactSound(this.impacts.add(shot.worldHit), shot.worldHit.point, true);
    if (shot.playerDamage > 0) this.damagePlayer(shot.playerDamage, shot.part ?? 'body', RIFLE.armorRatio, shot.bot.name, RIFLE.name, shot.headshot, shot.bot);
    if (shot.victim) {
      this.impacts.addBlood(shot.end, this.toSound.subVectors(shot.end, shot.origin).normalize(), shot.headshot ? 18 : 10);
      if (shot.killed) this.hud.addKill(shot.bot.name, shot.victim.name, RIFLE.name, shot.headshot);
    }
  }

  /** Un bot blesse un bot de l'autre camp (grenade) ; le tueur est crédité. */
  private botHurtsBot(attacker: Bot, victim: Bot, amount: number, zone: DamageZone, armorRatio: number, weapon: string, headshot: boolean): void {
    if (!this.bots.damageBot(victim, amount, zone, armorRatio, attacker.body.position)) return;
    attacker.kills++;
    this.hud.addKill(attacker.name, victim.name, weapon, headshot);
  }

  // --- En ligne (1 contre 1) ---

  private createDuel(): Duel {
    return new Duel(this.scene, this.player, {
      started: () => {
        // Deathmatch à deux : pas de bots, pas de grenades (pour l'instant).
        this.bots.setEnabled(false);
        this.spotted.clear();
        this.startMode('deathmatch');
      },
      ended: (message) => {
        // Retour au jeu seul, avec ses réglages ; on sort de la visée pour voir le message.
        this.applySettings(this.settings);
        if (this.settings.mode === this.mode) this.startMode(this.mode);
        if (message) document.exitPointerLock();
      },
      remoteShot: (def, from, ends) => this.onRemoteShot(def, from, ends),
      remoteSwing: (heavy) => {
        if (this.duel.remote.position.distanceTo(this.player.position) < 6) this.audio.knifeSwing(heavy);
      },
      hitByRemote: (def, part, damage, label) => {
        if (!this.player.alive) return;
        const weapon = label ?? def.name;
        const headshot = part === 'head' && !def.melee;
        this.damagePlayer(damage, part, def.armorRatio, this.duel.remote.name, weapon, headshot);
        if (!this.player.alive) this.duel.sendDeath(weapon, headshot);
      },
      killedRemote: (weapon, headshot) => {
        if (headshot) this.stats.headshots++;
        this.kills++;
        this.hud.addKill('Toi', this.duel.remote.name, weapon, headshot);
        this.hud.setScore(this.kills, this.deaths);
      },
    });
  }

  /** L'adversaire tire : son selon la distance, traînées depuis son arme et impacts sur les murs. */
  private onRemoteShot(def: WeaponDef, from: THREE.Vector3, ends: THREE.Vector3[]): void {
    const muzzle = this.duel.remote.muzzle(new THREE.Vector3());
    const { loudness, pan, distance } = this.hearing(muzzle);
    this.audio.shot(def, { distant: distance > CLOSE_SHOT_DISTANCE, loudness, pan });
    ends.forEach((end, i) => {
      // Trois traînées au plus pour un fusil à pompe.
      if (i < 3) this.tracers.add(muzzle, end);
      // La balle s'est arrêtée sur un mur ? On le retrouve de notre côté pour y faire un trou.
      const direction = end.clone().sub(from);
      const length = direction.length();
      if (length < 1e-3) return;
      this.raycaster.set(from, direction.divideScalar(length));
      this.raycaster.far = length + 0.05;
      const wall = this.raycaster.intersectObjects(this.world.meshes, false)[0];
      if (wall && wall.distance > length - 0.3) this.impactSound(this.impacts.add(wall), wall.point, i === 0);
    });
  }

  /** L'adversaire, comme obstacle (tant qu'il est vivant et en ligne). */
  private get remoteColliders(): THREE.Box3[] {
    return this.duel.active && this.duel.remote.alive && !this.duel.remote.box.isEmpty() ? [this.duel.remote.box] : [];
  }

  /** En ligne : réapparition hors de vue de l'adversaire, et loin de lui. */
  private duelSpawnPoint(): THREE.Vector3 {
    const remote = this.duel.remote;
    const eye = remote.eyePosition(new THREE.Vector3());
    let best = this.nav.randomWalkablePoint();
    let bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const candidate = this.nav.randomWalkablePoint();
      const head = candidate.clone().setY(candidate.y + PLAYER.eyeHeight);
      const seen = remote.alive && this.clearLine(eye, head);
      const score = candidate.distanceTo(remote.position) - (seen ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  // --- Bombe ---

  private createBomb(): BombMode {
    return new BombMode(this.scene, this.player, this.bots, {
      planted: (site, by) => this.onBombPlanted(site, by),
      exploded: (position) => this.onBombExploded(position),
      defused: (by) => {
        const { loudness, pan } = this.hearing(this.bomb.position);
        this.audio.bombDefused(Math.max(loudness, 0.5), pan);
        this.rounds.end('bots', `${by.name} a désamorcé la bombe`);
      },
      beep: (position) => {
        const { loudness, pan } = this.hearing(position);
        this.audio.bombBeep(loudness, pan);
      },
      pickedUp: (by) => {
        if (by === 'player') this.audio.draw();
      },
    });
  }

  /** Mode bombe, à chaque tick d'une manche en cours : pose (touche maintenue), bombe tombée, compte à rebours. */
  private updateBomb(): void {
    const planting = this.player.alive && this.input.isDown('use');
    this.bomb.update(TICK, planting);
    // Petits bips des touches tapées sur le clavier de la bombe pendant la pose.
    this.plantKeyTimer -= TICK;
    if (this.bomb.playerCarrying && this.bomb.plantProgress > 0 && this.plantKeyTimer <= 0) {
      this.plantKeyTimer = 0.32;
      this.audio.bombKey();
    }
  }

  private onBombPlanted(site: BombSite, by: Carrier): void {
    const { loudness, pan } = this.hearing(this.bomb.position);
    this.audio.bombPlanted(Math.max(loudness, 0.6), pan);
    if (by === 'player') this.economy.earn(BOMB.plantReward, 'Bombe posée');
    this.hud.addKill(by === 'player' ? 'Toi' : by.name, `site ${site.name}`, 'Bombe posée', false);
  }

  /** La bombe explose : tout le monde autour est touché (murs compris), et l'équipe du joueur gagne la manche. */
  private onBombExploded(position: THREE.Vector3): void {
    const { loudness, pan, distance } = this.hearing(position);
    this.audio.bombExplosion(Math.max(loudness, 0.5), pan);
    this.grenades.bigExplosion(position);
    const shake = Math.max(0, 1 - distance / 40) * 0.12;
    this.weapons.punch.pitch += (Math.random() - 0.3) * shake;
    this.weapons.punch.yaw += (Math.random() - 0.5) * shake;

    const sigma = BOMB.radius / 3;
    const damageAt = (feet: THREE.Vector3) => {
      const d = feet.distanceTo(position);
      return d > BOMB.radius ? 0 : BOMB.damage * Math.exp(-(d * d) / (2 * sigma * sigma));
    };
    for (const bot of this.bots.bots) {
      if (!bot.alive) continue;
      const damage = damageAt(bot.body.position);
      if (damage >= 1 && this.bots.damageBot(bot, damage, 'blast', BLAST_ARMOR_RATIO, position)) this.hud.addKill('Bombe', bot.name, 'C4', false);
    }
    if (this.player.alive) {
      const damage = damageAt(this.player.position);
      if (damage >= 1) this.damagePlayer(damage, 'blast', BLAST_ARMOR_RATIO, 'Bombe', 'C4');
    }
    this.rounds.end('player', 'La bombe a explosé');
  }

  /** Consigne affichée en haut de l'écran en mode bombe. */
  private bombObjective(): { text: string; progress: number | null; alert?: boolean } | null {
    const bomb = this.bomb;
    if (this.rounds.current.phase !== 'live') return null;
    switch (bomb.state) {
      case 'carried': {
        if (bomb.carrier !== 'player') return { text: `${bomb.carrier!.name} a la bombe`, progress: bomb.plantProgress > 0 ? bomb.plantProgress : null };
        const site = bomb.siteAt(this.player.position);
        if (bomb.plantProgress > 0) return { text: `Pose de la bombe sur ${site?.name ?? ''}…`, progress: bomb.plantProgress };
        if (site) return { text: `Site ${site.name} : maintiens ${this.useKey} pour poser la bombe`, progress: null };
        return { text: 'Tu as la bombe : pose-la sur le site A ou B', progress: null };
      }
      case 'dropped':
        return { text: 'Bombe tombée !', progress: null, alert: true };
      case 'planted': {
        const time = `${Math.ceil(bomb.timeLeft)} s`;
        if (bomb.defuser) return { text: `${bomb.defuser.name} désamorce la bombe ! (${time})`, progress: bomb.defuseProgress, alert: true };
        return { text: `Bombe posée sur ${bomb.site!.name} · explosion dans ${time}`, progress: null };
      }
      default:
        return null;
    }
  }

  /** Repères du radar en mode bombe : lettres des sites et bombe au sol (rouge). */
  private radarMarks(): RadarMark[] {
    if (this.mode !== 'bomb') return [];
    const marks: RadarMark[] = BOMB_SITES.map((site) => ({ x: site.center.x, z: site.center.z, color: '#ff8a3d', label: site.name }));
    if (this.bomb.state === 'dropped' || this.bomb.state === 'planted') marks.push({ x: this.bomb.position.x, z: this.bomb.position.z, color: '#ff3b1f' });
    return marks;
  }

  // --- Grenades ---

  private createGrenades(): GrenadeSystem {
    return new GrenadeSystem(this.scene, this.player, {
      colliders: () => [...this.world.colliders, ...this.bots.colliders, this.player.box],
      lineOfSight: (from, to) => this.clearLine(from, to),
      floorBelow: (position) => {
        this.raycaster.set(position, new THREE.Vector3(0, -1, 0));
        this.raycaster.far = 50;
        return this.raycaster.intersectObjects(this.world.meshes, false)[0]?.point.y ?? 0;
      },
      pulled: () => this.audio.pin(),
      thrown: () => this.audio.throwWhoosh(),
      emptyHanded: () => this.weapons.unholster(),
      bounce: (position, speed) => {
        const { loudness, pan } = this.hearing(position);
        this.audio.bounce(loudness * Math.min(speed / 8, 1), pan);
      },
      explode: (position, owner) => {
        const { loudness, pan, distance } = this.hearing(position);
        this.audio.explosion(loudness, pan);
        this.applyAreaDamage(position, HE.radius, HE.damage, GRENADES.he.name, owner as Bot | null);
        this.bots.playerFired(position);
        // Secousse de la vue si l'explosion est proche.
        const shake = Math.max(0, 1 - distance / 15) * 0.06;
        this.weapons.punch.pitch += (Math.random() - 0.3) * shake;
        this.weapons.punch.yaw += (Math.random() - 0.5) * shake;
      },
      flashbang: (position, owner) => {
        const { loudness, pan } = this.hearing(position);
        this.audio.flashbang(loudness, pan);
        this.bots.flash(position, owner);
        if (!this.player.alive) return;
        this.player.eyePosition(this.eye);
        this.camera.getWorldDirection(this.forward);
        const visible = this.clearLine(position, this.eye) && !this.grenades.blocksVision(position, this.eye);
        const duration = flashDuration(position, this.eye, this.forward, visible);
        if (duration > 0.3) this.audio.ring(Math.min(duration, 3));
        this.flashTime = Math.max(this.flashTime, duration);
      },
      smoke: (position) => {
        const { loudness, pan } = this.hearing(position);
        this.audio.smoke(loudness, pan);
      },
      fire: (position, fizzled) => {
        const { loudness, pan } = this.hearing(position);
        this.audio.molotov(loudness, pan, fizzled, MOLOTOV.duration);
      },
      decoyShot: (position) => {
        // Le leurre imite un fusil : même son qu'un bot, et les bots viennent voir.
        const { loudness, pan, distance } = this.hearing(position);
        this.audio.shot(RIFLE, { distant: distance > CLOSE_SHOT_DISTANCE, loudness: Math.min(loudness, 0.8), pan });
        this.bots.playerFired(position);
      },
      decoyEnded: (position) => {
        const { loudness, pan } = this.hearing(position);
        this.audio.decoyPop(loudness, pan);
        this.applyAreaDamage(position, DECOY.radius, DECOY.damage, GRENADES.decoy.name);
      },
    });
  }

  /** Bruit d'une balle qui frappe une surface (si `audible`), atténué avec la distance. */
  private impactSound(surface: Surface, point: THREE.Vector3, audible: boolean): void {
    if (!audible) return;
    const { loudness, pan, distance } = this.hearing(point);
    if (distance < IMPACT_HEARING) this.audio.impact(surface, loudness * 0.6, pan);
  }

  /** Pas du joueur et des bots : un bruit tous les `STRIDE` mètres en courant (silence en marchant ou accroupi). */
  private updateFootsteps(): void {
    const player = this.player;
    if (player.alive) {
      // Réception d'un saut ou d'une chute.
      if (player.onGround && !this.wasOnGround && this.fallSpeed > LANDING_SPEED) {
        this.audio.footstep(this.surfaceUnder(player.position), 0.8, 0, true);
        this.bots.heardStep(player.position);
      }
      if (!player.onGround) this.fallSpeed = Math.max(0, -player.velocity.y);
      this.wasOnGround = player.onGround;

      if (player.onGround && player.horizontalSpeed > STEP_SPEED) {
        this.playerStride += player.horizontalSpeed * TICK;
        if (this.playerStride > STRIDE) {
          this.playerStride = 0;
          this.audio.footstep(this.surfaceUnder(player.position), 0.45, 0);
          this.bots.heardStep(player.position);
        }
      }
    }
    for (const bot of this.bots.bots) {
      if (!bot.alive || !bot.body.onGround || bot.body.horizontalSpeed < STEP_SPEED) continue;
      const stride = (this.botStrides.get(bot) ?? Math.random() * STRIDE) + bot.body.horizontalSpeed * TICK;
      if (stride < STRIDE) {
        this.botStrides.set(bot, stride);
        continue;
      }
      this.botStrides.set(bot, 0);
      const { loudness, pan, distance } = this.hearing(bot.body.position);
      if (distance < FOOTSTEP_HEARING) this.audio.footstep(this.surfaceUnder(bot.body.position), loudness * (1 - distance / FOOTSTEP_HEARING), pan);
    }

    // L'adversaire en ligne : on l'entend courir, comme un bot.
    const remote = this.duel.remote;
    if (!this.duel.active || !remote.alive || !remote.onGround || remote.speed < STEP_SPEED) return;
    this.remoteStride += remote.speed * TICK;
    if (this.remoteStride < STRIDE) return;
    this.remoteStride = 0;
    const { loudness, pan, distance } = this.hearing(remote.position);
    if (distance < FOOTSTEP_HEARING) this.audio.footstep(this.surfaceUnder(remote.position), loudness * (1 - distance / FOOTSTEP_HEARING), pan);
  }

  /** Matière du sol sous des pieds (pour le bruit des pas). */
  private surfaceUnder(feet: THREE.Vector3): Surface {
    this.raycaster.set(feet.clone().setY(feet.y + 0.2), DOWN);
    this.raycaster.far = 0.6;
    return surfaceOf(this.raycaster.intersectObjects(this.world.meshes, false)[0]?.object);
  }

  /** Un bot lance une grenade : trajectoire calculée pour retomber près de la cible. */
  private onBotGrenade(bot: Bot, type: 'he' | 'flash', target: THREE.Vector3): void {
    const origin = bot.eyePosition(new THREE.Vector3());
    const aim = target.clone().setY(target.y + 0.3);
    origin.addScaledVector(aim.clone().sub(origin).setY(0).normalize(), 0.4);
    this.grenades.launch(type, origin, throwVelocity(origin, aim), bot.body.box, bot);
    const { loudness, pan } = this.hearing(origin);
    this.audio.bounce(loudness * 0.6, pan);
  }

  /** Volume et position gauche/droite d'un son, selon où il se trouve par rapport au joueur. */
  private hearing(position: THREE.Vector3): { loudness: number; pan: number; distance: number } {
    const distance = position.distanceTo(this.camera.position);
    this.toSound.subVectors(position, this.camera.position).normalize();
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    return {
      distance,
      loudness: THREE.MathUtils.clamp(1 - distance / HEARING_DISTANCE, 0.12, 1),
      pan: this.toSound.dot(this.right) * 0.8,
    };
  }

  /** Vrai si aucun mur ne coupe la ligne entre deux points. */
  private clearLine(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const direction = to.clone().sub(from);
    const distance = direction.length();
    if (distance < 1e-3) return true;
    this.raycaster.set(from, direction.divideScalar(distance));
    this.raycaster.far = distance;
    return this.raycaster.intersectObjects(this.world.meshes, false).length === 0;
  }

  // --- Modes de jeu ---

  /** Applique tous les réglages (appelé au démarrage et à chaque changement dans le menu). */
  private applySettings(settings: Settings): void {
    this.input.setBindings(settings.bindings);
    this.useKey = keyName(settings.bindings.use[0] ?? 'KeyE');
    this.player.sensitivity = (0.022 * settings.sensitivity * Math.PI) / 180;
    this.player.invertY = settings.invertY;
    if (this.camera.fov !== settings.fov) {
      this.camera.fov = settings.fov;
      this.camera.updateProjectionMatrix();
    }
    this.audio.setVolume(settings.volume / 100);
    this.hud.setCrosshair(settings.crosshairColor, settings.crosshairSize);
    this.hud.setSpeedVisible(settings.showSpeed);
    this.applyGraphics(settings);

    // En ligne, le mode et les bots sont imposés ; ces réglages reprendront effet après la partie.
    this.settings = settings;
    if (this.duel?.active) return;
    this.bots.setDifficulty(settings.difficulty);
    this.bots.setCount(settings.botCount);
    this.bots.setAllies(settings.allyCount);
    this.bots.setAggressive(settings.botsAggressive);
    this.bots.setEnabled(settings.botsEnabled);
    if (settings.mode !== this.mode) this.startMode(settings.mode);
  }

  /** Ombres et résolution de rendu (onglet Graphismes). */
  private applyGraphics(settings: Settings): void {
    const shadowSize = SHADOW_MAP_SIZES[settings.shadows];
    this.sun.castShadow = shadowSize > 0;
    if (shadowSize > 0 && this.sun.shadow.mapSize.x !== shadowSize) {
      // Changer la taille de la carte d'ombre oblige à la recréer.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    }
    const pixelRatio = Math.min(window.devicePixelRatio, 2) * (settings.renderScale / 100);
    if (this.renderer.getPixelRatio() !== pixelRatio) {
      this.renderer.setPixelRatio(pixelRatio);
      this.resize();
    }
    this.hud.setFpsVisible(settings.showFps);
  }

  /** Manches et bombe : une vie par manche, économie, achats limités dans le temps. */
  private get roundBased(): boolean {
    return this.mode !== 'deathmatch';
  }

  private startMode(mode: GameMode): void {
    this.mode = mode;
    this.resetStats();
    this.hud.setScore(0, 0);
    this.bots.respawnEnabled = mode === 'deathmatch';
    if (mode !== 'bomb') this.bomb.stop();
    if (this.roundBased) {
      this.rounds.startMatch();
    } else {
      this.grenades.clear();
      this.respawn();
      this.bots.resetForRound();
    }
  }

  /**
   * Nouvelle manche, comme dans CS : si on a survécu, on garde armes, gilet et
   * grenades ; si on est mort (ou en début de match), il ne reste que le pistolet.
   */
  private resetRound(newMatch: boolean): void {
    const diedLastRound = !this.player.alive;
    if (newMatch) {
      this.economy.reset();
      this.resetStats();
    }
    if (newMatch || diedLastRound) {
      this.weapons.setPrimary(null, false);
      this.player.armor = 0;
      this.player.helmet = false;
      this.grenades.empty();
    }
    this.respawnTimer = null;
    this.killer = '';
    this.flashTime = 0;
    const offset = new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 2);
    this.player.spawn(PLAYER_SPAWN.position.clone().add(offset), PLAYER_SPAWN.yaw);
    this.weapons.reset();
    this.grenades.clear();
    this.buyMenu.close();
    this.bots.resetForRound();
    if (this.mode === 'bomb') this.bomb.startRound();
  }

  /** Réapparition en deathmatch, hors de vue des bots. */
  private respawn(): void {
    this.respawnTimer = null;
    this.flashTime = 0;
    const position = this.duel?.active ? this.duelSpawnPoint() : this.bots.playerSpawnPoint();
    // Face au centre de la carte.
    this.player.spawn(position, Math.atan2(position.x, position.z));
    // Deathmatch : gilet, casque et grenades offerts ; on garde l'arme principale choisie.
    this.player.armor = 100;
    this.player.helmet = true;
    if (!this.weapons.primary) this.weapons.setPrimary(RIFLE, false);
    this.weapons.reset();
    this.grenades.unequip();
    // Pas encore de grenades en ligne : elles ne seraient que chez soi.
    if (this.duel?.active) this.grenades.empty();
    else this.grenades.refill();
  }

  // --- Affichage ---

  /** Tableau des scores, tant que la touche (Tab) est maintenue. */
  private updateScoreboard(): void {
    if (!this.input.isDown('scoreboard')) {
      this.hud.setScoreboard(null);
      return;
    }
    const accuracy = this.stats.shots > 0 ? Math.round((100 * this.stats.hits) / this.stats.shots) : 0;
    const row = (bot: Bot) => ({ name: bot.name, kills: bot.kills, deaths: bot.deaths, extra: '', me: false, dead: !bot.alive, ally: bot.team === 'ally' });
    const byScore = (a: { kills: number; deaths: number }, b: { kills: number; deaths: number }) => b.kills - a.kills || a.deaths - b.deaths;
    const me = { name: 'Toi', kills: this.kills, deaths: this.deaths, extra: `${this.stats.headshots} HS · ${accuracy} %`, me: true, dead: !this.player.alive, ally: true };
    const enemies = this.bots.enemies.map(row);
    if (this.duel.active) {
      // En ligne : ses éliminations sont nos morts, et inversement.
      const remote = this.duel.remote;
      enemies.push({ name: remote.name, kills: this.deaths, deaths: this.kills, extra: '', me: false, dead: !remote.alive, ally: false });
    }
    // Avec des coéquipiers : ton équipe d'abord, puis les ennemis, chaque camp trié par éliminations.
    const rows =
      this.bots.allies.length > 0 ? [...[me, ...this.bots.allies.map(row)].sort(byScore), ...enemies.sort(byScore)] : [me, ...enemies].sort(byScore);
    const round = this.rounds.current;
    const title = this.roundBased
      ? `${this.mode === 'bomb' ? 'Bombe' : 'Manches'} · manche ${round.round} · Toi ${round.playerScore} – ${round.botScore} Bots`
      : this.duel.active
        ? `En ligne · 1 contre 1 face à ${this.duel.remote.name}`
        : 'Deathmatch';
    this.hud.setScoreboard({ title, rows });
  }

  /** Bilan du joueur : éliminations, morts, précision, headshots, dégâts. */
  private statsLine(): string {
    const { shots, hits, headshots, damage } = this.stats;
    const accuracy = shots > 0 ? Math.round((100 * hits) / shots) : 0;
    return `${this.kills} élim. / ${this.deaths} morts · précision ${accuracy} % · ${headshots} headshots · ${Math.round(damage)} dégâts`;
  }

  /** Radar : ennemis repérés (dans le champ de vision et sans mur ni fumée entre eux et nous). */
  private updateRadar(): void {
    const now = performance.now();
    if (now - this.lastSpotting > SPOT_INTERVAL_MS && this.player.alive) {
      this.lastSpotting = now;
      this.frustum.setFromProjectionMatrix(this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
      for (const bot of this.bots.enemies) {
        if (!bot.alive) continue;
        const head = bot.eyePosition(this.eye.clone());
        if (!this.frustum.containsPoint(head) || !this.clearLine(this.camera.position, head)) continue;
        if (this.grenades.blocksVision(this.camera.position, head)) continue;
        this.spotted.set(bot, now);
      }
      const remote = this.duel.remote;
      if (this.duel.active && remote.alive) {
        const head = remote.eyePosition(this.eye.clone());
        if (this.frustum.containsPoint(head) && this.clearLine(this.camera.position, head)) this.remoteSpotted = now;
      }
    }
    const enemies = [];
    for (const [bot, time] of this.spotted) {
      const age = now - time;
      if (!bot.alive || age > SPOT_MEMORY_MS) continue;
      enemies.push({ x: bot.body.position.x, z: bot.body.position.z, alpha: 1 - age / SPOT_MEMORY_MS });
    }
    const remoteAge = now - this.remoteSpotted;
    if (this.duel.active && this.duel.remote.alive && remoteAge < SPOT_MEMORY_MS) {
      enemies.push({ x: this.duel.remote.position.x, z: this.duel.remote.position.z, alpha: 1 - remoteAge / SPOT_MEMORY_MS });
    }
    // Les coéquipiers sont toujours affichés, comme dans CS.
    const allies = this.bots.allies.filter((bot) => bot.alive).map((bot) => ({ x: bot.body.position.x, z: bot.body.position.z }));
    this.radar.draw({ x: this.player.position.x, z: this.player.position.z, yaw: this.player.yaw }, enemies, allies, this.radarMarks());
  }

  private updateEffects(dt: number, mouse: { dx: number; dy: number }): void {
    this.viewModel.update(dt, {
      speed: Math.min(this.player.horizontalSpeed / MOVE.maxSpeed, 1),
      onGround: this.player.onGround,
      mouseDX: mouse.dx,
      mouseDY: mouse.dy,
      reload: this.weapons.reloadProgress,
      draw: this.weapons.drawProgress,
      grenade: this.grenades.current ? this.grenades.pose : null,
    });
    this.impacts.update(dt);
    this.tracers.update(dt);

    this.muzzleLightTimer -= dt;
    this.muzzleLight.intensity = this.muzzleLightTimer > 0 ? 25 : 0;
    this.camera.getWorldDirection(this.forward);
    this.muzzleLight.position.copy(this.camera.position).addScaledVector(this.forward, 0.8);
  }

  private updateHud(): void {
    this.hud.setSpeed(this.player.horizontalSpeed / UNIT);
    this.hud.setHealth(this.player.health);
    // Écran blanc tant que la flash fait effet (voir Hud.setFlash).
    this.hud.setFlash(this.flashTime);
    this.hud.setSmoke(this.grenades.smokeAt(this.camera.position) * 0.92);

    const gain = this.economy.lastGain && performance.now() - this.economy.lastGain.time < GAIN_DISPLAY_MS ? this.economy.lastGain : null;
    this.hud.setMoney(this.roundBased ? this.economy.money : null, gain);
    this.hud.setArmor(this.player.armor, this.player.helmet);
    this.buyMenu.render(
      SHOP_ITEMS.map((item) => ({ key: item.key, label: item.label, price: this.priceOf(item), state: this.itemState(item) })),
      this.roundBased ? this.economy.money : null,
      this.buyTimeLeft,
    );

    const grenade = this.grenades.def;
    if (grenade) this.hud.setAmmo(grenade.name, this.grenades.counts[grenade.type], null);
    else if (this.weapons.current.def.melee) this.hud.setAmmo(this.weapons.current.def.name, null, null);
    else {
      const { def, ammo, reserve } = this.weapons.current;
      this.hud.setAmmo(def.name, ammo, reserve);
    }
    this.hud.setGrenades(
      GRENADE_ORDER.map((type) => ({
        label: GRENADES[type].short,
        count: this.grenades.counts[type],
        current: type === this.grenades.current,
      })),
    );

    this.updateScoreboard();
    this.hud.setObjective(this.mode === 'bomb' ? this.bombObjective() : null);
    if (this.mode === 'deathmatch') {
      this.hud.setRound(null);
      this.hud.setBanner(null);
      this.hud.setDeath(this.killer, this.respawnTimer === null ? null : `réapparition dans ${Math.ceil(this.respawnTimer)} s`);
      return;
    }
    this.updateRoundHud();
  }

  private updateRoundHud(): void {
    const round = this.rounds.current;
    const live = round.phase === 'live';
    this.hud.setRound({
      player: round.playerScore,
      bots: round.botScore,
      time: live || round.phase === 'freeze' ? round.timeLeft : 0,
      alive: this.bots.aliveCount,
    });
    this.hud.setDeath(this.killer, !this.player.alive && live ? 'attends la manche suivante' : null);

    switch (round.phase) {
      case 'freeze':
        this.hud.setBanner({ title: `Manche ${round.round}`, text: `Départ dans ${Math.ceil(round.timeLeft)}…` });
        break;
      case 'live':
        this.hud.setBanner(null);
        break;
      case 'over': {
        const won = round.winner === 'player';
        this.hud.setBanner({ title: won ? 'Manche gagnée !' : 'Manche perdue', text: round.reason, tone: won ? 'win' : 'loss' });
        break;
      }
      case 'matchOver': {
        const won = round.playerScore > round.botScore;
        this.hud.setBanner({
          title: won ? 'Victoire !' : 'Défaite',
          text: `${round.playerScore} – ${round.botScore} · ${this.statsLine()} · nouveau match dans ${Math.ceil(round.timeLeft)} s`,
          tone: won ? 'win' : 'loss',
        });
        break;
      }
    }
  }

  private resize(): void {
    const { innerWidth: width, innerHeight: height } = window;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.viewModel.resize(width / height);
    this.renderer.setSize(width, height);
  }
}
