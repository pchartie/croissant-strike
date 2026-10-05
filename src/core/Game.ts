import * as THREE from 'three';
import type { Bot } from '../bots/Bot';
import { BotManager, type BotShot } from '../bots/BotManager';
import { CAMERA, MOVE, PLAYER, TICK, UNIT } from '../config';
import { DECOY, GRENADE_ORDER, GRENADES, HE, MOLOTOV } from '../grenades/definitions';
import { flashDuration } from '../grenades/flashbang';
import { GrenadeSystem } from '../grenades/GrenadeSystem';
import { Player } from '../player/Player';
import { Hud } from '../ui/Hud';
import { SettingsPanel } from '../ui/SettingsPanel';
import { RIFLE, type WeaponDef } from '../weapons/definitions';
import { Impacts } from '../weapons/Impacts';
import { loadRetroWeapons } from '../weapons/RetroWeapons';
import { Tracers } from '../weapons/Tracers';
import { ViewModel } from '../weapons/ViewModel';
import { WeaponSystem, type MeleeKind } from '../weapons/WeaponSystem';
import { buildLevel, LEVEL_BOUNDS, PLAYER_SPAWN } from '../world/Level';
import { NavGrid } from '../world/NavGrid';
import { loadSky } from '../world/sky';
import { World } from '../world/World';
import { Audio } from './Audio';
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
  private mode: GameMode = 'deathmatch';

  /** Éclaire brièvement les alentours à chaque tir. */
  private readonly muzzleLight = new THREE.PointLight(0xffb060, 0, 8, 2);
  private muzzleLightTimer = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly forward = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly toSound = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  private kills = 0;
  private deaths = 0;
  /** Temps restant avant de réapparaître (deathmatch), ou null. */
  private respawnTimer: number | null = null;
  private killer = '';
  /** Aveuglement restant après une flash, en secondes. */
  private flashTime = 0;
  private hurtCooldown = 0;

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

    buildLevel(this.world, this.renderer.capabilities.getMaxAnisotropy());
    void loadSky(this.scene, [this.viewModel.scene]);
    this.scene.add(this.muzzleLight);
    this.player.spawn(PLAYER_SPAWN.position, PLAYER_SPAWN.yaw);

    this.nav = new NavGrid(this.world.colliders, LEVEL_BOUNDS, PLAYER.radius + 0.1, PLAYER_SPAWN.position);
    this.bots = new BotManager(this.scene, this.world, this.nav, this.player, {
      shot: (shot) => this.onBotShot(shot),
    });

    this.weapons = new WeaponSystem(this.player, () => [...this.world.meshes, ...this.bots.hitboxes], {
      fired: (def, hit, direction) => this.onPlayerShot(def, hit, direction),
      reloadStarted: (def) => {
        this.viewModel.reload(def);
        this.audio.reload(def);
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
      },
      struck: (def, kind, hit, direction, combo) => this.onKnifeStrike(def, kind, hit, direction, combo),
    });

    this.grenades = this.createGrenades();
    this.bots.setVisionBlocker((from, to) => this.grenades.blocksVision(from, to));
    this.rounds = new Rounds(() => this.resetRound());

    this.hud.setScore(0, 0);
    const settings = loadSettings();
    this.applySettings(settings);
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
    this.updateEffects(frameTime, mouse);
    this.updateHud();

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.player.alive) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewModel.scene, this.viewModel.camera);
    }
  }

  private tick(): void {
    // Pendant le gel de début de manche, on peut regarder autour mais pas bouger ni tirer.
    const frozen = this.mode === 'rounds' && this.rounds.frozen;

    if (this.player.alive && !frozen) {
      this.player.update(TICK, this.input, [...this.world.colliders, ...this.bots.colliders]);
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
    if (this.mode === 'rounds') this.rounds.update(TICK, this.player.alive, this.bots.aliveCount);

    this.flashTime = Math.max(0, this.flashTime - TICK);
    this.hurtCooldown = Math.max(0, this.hurtCooldown - TICK);
    this.input.endTick();
  }

  // --- Dégâts ---

  /** Dégâts infligés au joueur, par un bot ou par une grenade (les siennes comprises). */
  private damagePlayer(amount: number, attacker: string, weapon: string, headshot = false): void {
    if (!this.player.alive) return;
    this.player.health -= amount;
    if (this.hurtCooldown === 0) {
      this.hud.showDamage();
      this.audio.hurt();
      this.hurtCooldown = HURT_SOUND_INTERVAL;
    }
    if (this.player.alive) return;

    this.deaths++;
    this.killer = attacker;
    this.hud.addKill(attacker, 'Toi', weapon, headshot);
    this.hud.setScore(this.kills, this.deaths);
    if (this.mode === 'deathmatch') this.respawnTimer = RESPAWN_DELAY;
  }

  /** Dégâts infligés à un bot par le joueur ; renvoie vrai s'il en meurt. */
  private damageBot(bot: Bot, amount: number, weapon: string, headshot = false): boolean {
    const killed = this.bots.damageBot(bot, amount);
    if (killed) {
      this.kills++;
      this.hud.addKill('Toi', bot.name, weapon, headshot);
      this.hud.setScore(this.kills, this.deaths);
    }
    return killed;
  }

  /**
   * Explosion : dégâts à tous ceux qu'elle « voit » (les murs protègent), forts
   * au centre et qui baissent vite avec la distance, comme la HE de CS:GO.
   */
  private applyAreaDamage(center: THREE.Vector3, radius: number, maxDamage: number, weapon: string): void {
    const sigma = radius / 3;
    const origin = center.clone().setY(center.y + 0.1);
    const hits = (feet: THREE.Vector3, height: number) => {
      const body = feet.clone().setY(feet.y + height / 2);
      const distance = body.distanceTo(origin);
      if (distance > radius || !this.clearLine(origin, body)) return 0;
      return maxDamage * Math.exp(-(distance * distance) / (2 * sigma * sigma));
    };

    for (const bot of this.bots.bots) {
      if (!bot.alive) continue;
      const damage = hits(bot.body.position, bot.body.height);
      if (damage >= 1) this.damageBot(bot, damage, weapon);
    }
    if (this.player.alive) {
      const damage = hits(this.player.position, this.player.height);
      if (damage >= 1) this.damagePlayer(damage, 'Toi', weapon);
    }
  }

  /** Feux de molotov : brûlent le joueur et les bots qui sont dedans. */
  private applyFire(): void {
    const burning = (feet: THREE.Vector3) => this.grenades.burning(feet);
    const damage = MOLOTOV.damagePerSecond * TICK;
    if (this.player.alive && burning(this.player.position)) this.damagePlayer(damage, 'Toi', GRENADES.molotov.name);
    this.bots.burn((feet) => this.grenades.fireAt(feet), (bot) => this.damageBot(bot, damage, GRENADES.molotov.name));
  }

  // --- Tirs ---

  private onPlayerShot(def: WeaponDef, hit: THREE.Intersection | null, direction: THREE.Vector3): void {
    this.viewModel.kick(def);
    this.audio.shot(def);
    this.muzzleLightTimer = MUZZLE_LIGHT_DURATION;
    this.bots.playerFired(this.player.position);
    if (!hit) return;

    if (!hit.object.userData.bot) {
      this.impacts.add(hit);
      return;
    }
    const { bot, part, killed } = this.bots.hit(hit.object, def.damage);
    const headshot = part === 'head';
    this.impacts.addBlood(hit.point, direction, headshot ? 18 : 10);
    this.hud.showHitmarker(headshot);
    this.audio.hit(headshot);
    if (killed) {
      this.kills++;
      this.hud.addKill('Toi', bot.name, def.name, headshot);
      this.hud.setScore(this.kills, this.deaths);
    }
  }

  /**
   * Coup de couteau qui arrive : dégâts de CS:GO (40 puis 25 en enchaînant au
   * clic gauche, 65 au clic droit), bien plus dans le dos.
   */
  private onKnifeStrike(def: WeaponDef, kind: MeleeKind, hit: THREE.Intersection | null, direction: THREE.Vector3, combo: boolean): void {
    if (!hit) return;
    if (!hit.object.userData.bot) {
      this.impacts.add(hit);
      this.audio.knifeWall();
      return;
    }
    const bot = hit.object.userData.bot as Bot;
    const melee = def.melee!;
    const backstab = this.isBehind(bot);
    const damage = backstab ? melee[kind].backstab : kind === 'light' && combo ? melee.light.followUp : melee[kind].damage;
    this.impacts.addBlood(hit.point, direction, backstab ? 20 : 12);
    this.hud.showHitmarker(backstab);
    this.audio.knifeHit();
    this.damageBot(bot, damage, backstab ? `${def.name} · dans le dos` : def.name);
  }

  /** Vrai si le joueur est derrière le bot (le bot lui tourne le dos). */
  private isBehind(bot: Bot): boolean {
    const facing = bot.forward(this.forward).setY(0).normalize();
    const toBot = this.toSound.subVectors(bot.body.position, this.player.position).setY(0).normalize();
    return facing.dot(toBot) > BACKSTAB_DOT;
  }

  private onBotShot(shot: BotShot): void {
    const { loudness, pan, distance } = this.hearing(shot.origin);
    this.audio.shot(RIFLE, { distant: distance > CLOSE_SHOT_DISTANCE, loudness: Math.min(loudness, 0.8), pan });
    this.tracers.add(shot.origin, shot.end);
    if (shot.worldHit) this.impacts.add(shot.worldHit);
    if (shot.playerDamage > 0) this.damagePlayer(shot.playerDamage, shot.bot.name, RIFLE.name, shot.headshot);
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
      explode: (position) => {
        const { loudness, pan, distance } = this.hearing(position);
        this.audio.explosion(loudness, pan);
        this.applyAreaDamage(position, HE.radius, HE.damage, GRENADES.he.name);
        this.bots.playerFired(position);
        // Secousse de la vue si l'explosion est proche.
        const shake = Math.max(0, 1 - distance / 15) * 0.06;
        this.weapons.punch.pitch += (Math.random() - 0.3) * shake;
        this.weapons.punch.yaw += (Math.random() - 0.5) * shake;
      },
      flashbang: (position) => {
        const { loudness, pan } = this.hearing(position);
        this.audio.flashbang(loudness, pan);
        this.bots.flash(position);
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
    this.player.sensitivity = (0.022 * settings.sensitivity * Math.PI) / 180;
    this.player.invertY = settings.invertY;
    if (this.camera.fov !== settings.fov) {
      this.camera.fov = settings.fov;
      this.camera.updateProjectionMatrix();
    }
    this.audio.setVolume(settings.volume / 100);
    this.hud.setCrosshair(settings.crosshairColor, settings.crosshairSize);
    this.hud.setSpeedVisible(settings.showSpeed);

    this.bots.setDifficulty(settings.difficulty);
    this.bots.setCount(settings.botCount);
    this.bots.setAggressive(settings.botsAggressive);
    this.bots.setEnabled(settings.botsEnabled);
    if (settings.mode !== this.mode) this.startMode(settings.mode);
  }

  private startMode(mode: GameMode): void {
    this.mode = mode;
    this.kills = this.deaths = 0;
    this.hud.setScore(0, 0);
    this.bots.respawnEnabled = mode === 'deathmatch';
    if (mode === 'rounds') {
      this.rounds.startMatch();
    } else {
      this.grenades.clear();
      this.respawn();
      this.bots.resetForRound();
    }
  }

  /** Nouvelle manche : tout le monde à sa place, santé, munitions et grenades refaites. */
  private resetRound(): void {
    this.respawnTimer = null;
    this.killer = '';
    this.flashTime = 0;
    const offset = new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 2);
    this.player.spawn(PLAYER_SPAWN.position.clone().add(offset), PLAYER_SPAWN.yaw);
    this.weapons.reset();
    this.grenades.clear();
    this.grenades.refill();
    this.bots.resetForRound();
  }

  /** Réapparition en deathmatch, hors de vue des bots. */
  private respawn(): void {
    this.respawnTimer = null;
    this.flashTime = 0;
    const position = this.bots.playerSpawnPoint();
    // Face au centre de la carte.
    this.player.spawn(position, Math.atan2(position.x, position.z));
    this.weapons.reset();
    this.grenades.unequip();
    this.grenades.refill();
  }

  // --- Affichage ---

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
          text: `${round.playerScore} – ${round.botScore} · nouveau match dans ${Math.ceil(round.timeLeft)} s`,
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
