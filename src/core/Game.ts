import * as THREE from 'three';
import { BotManager, type BotShot } from '../bots/BotManager';
import { CAMERA, MOVE, PLAYER, TICK, UNIT } from '../config';
import { Player } from '../player/Player';
import { Hud } from '../ui/Hud';
import { RIFLE, type WeaponDef } from '../weapons/definitions';
import { Impacts } from '../weapons/Impacts';
import { Tracers } from '../weapons/Tracers';
import { ViewModel } from '../weapons/ViewModel';
import { loadRetroWeapons } from '../weapons/RetroWeapons';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { buildLevel, LEVEL_BOUNDS, PLAYER_SPAWN } from '../world/Level';
import { NavGrid } from '../world/NavGrid';
import { World } from '../world/World';
import { Audio } from './Audio';
import { Input } from './Input';
import { loadSettings, saveSettings, type Settings } from './settings';

const MAX_FRAME_TIME = 0.1;
const MUZZLE_LIGHT_DURATION = 0.04;
const RESPAWN_DELAY = 3;
/** Distance à laquelle un tir de bot devient presque inaudible. */
const HEARING_DISTANCE = 60;

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
  private readonly weapons: WeaponSystem;
  private readonly bots: BotManager;

  /** Éclaire brièvement les alentours à chaque tir. */
  private readonly muzzleLight = new THREE.PointLight(0xffb060, 0, 8, 2);
  private muzzleLightTimer = 0;
  private readonly forward = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();

  private kills = 0;
  private deaths = 0;
  /** Temps restant avant de réapparaître, ou null si le joueur est en vie. */
  private respawnTimer: number | null = null;
  private killer = '';

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
    this.scene.add(this.muzzleLight);
    this.player.spawn(PLAYER_SPAWN.position, PLAYER_SPAWN.yaw);

    const nav = new NavGrid(this.world.colliders, LEVEL_BOUNDS, PLAYER.radius + 0.1, PLAYER_SPAWN.position);
    this.bots = new BotManager(this.scene, this.world, nav, this.player, {
      shot: (shot) => this.onBotShot(shot),
    });

    this.weapons = new WeaponSystem(this.player, () => [...this.world.meshes, ...this.bots.hitboxes], {
      fired: (def, hit, direction) => this.onPlayerShot(def, hit, direction),
      reloadStarted: (def) => {
        this.viewModel.reload(def);
        this.audio.reload(def);
      },
      drawn: (def) => {
        this.viewModel.show(def);
        this.audio.draw();
      },
      dryFired: () => this.audio.dryFire(),
    });

    this.hud.setScore(0, 0);
    const settings = loadSettings();
    this.applySettings(settings);
    this.hud.bindSettings(settings, (changed) => {
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
    if (this.player.alive) {
      this.player.update(TICK, this.input, [...this.world.colliders, ...this.bots.colliders]);
      if (this.player.outOfMap) this.player.spawn(PLAYER_SPAWN.position, PLAYER_SPAWN.yaw);
      this.weapons.update(TICK, this.input);
    } else if (this.respawnTimer !== null) {
      this.respawnTimer -= TICK;
      if (this.respawnTimer <= 0) this.respawn();
    }
    this.bots.update(TICK);
    this.input.endTick();
  }

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

  private onBotShot(shot: BotShot): void {
    const distance = shot.origin.distanceTo(this.player.eyePosition(this.eye));
    this.audio.shot(RIFLE, THREE.MathUtils.clamp(1 - distance / HEARING_DISTANCE, 0.12, 0.8));
    this.tracers.add(shot.origin, shot.end);
    if (shot.worldHit) this.impacts.add(shot.worldHit);
    if (shot.playerDamage === 0) return;

    this.player.health -= shot.playerDamage;
    this.hud.showDamage();
    this.audio.hurt();
    if (!this.player.alive) {
      this.deaths++;
      this.killer = shot.bot.name;
      this.respawnTimer = RESPAWN_DELAY;
      this.hud.addKill(shot.bot.name, 'Toi', RIFLE.name, shot.headshot);
      this.hud.setScore(this.kills, this.deaths);
    }
  }

  private applySettings(settings: Settings): void {
    this.bots.setAggressive(settings.botsAggressive);
    this.bots.setEnabled(settings.botsEnabled);
  }

  private respawn(): void {
    this.respawnTimer = null;
    const position = this.bots.playerSpawnPoint();
    // Face au centre de l'arène.
    this.player.spawn(position, Math.atan2(position.x, position.z));
    this.weapons.reset();
  }

  private updateEffects(dt: number, mouse: { dx: number; dy: number }): void {
    this.viewModel.update(dt, {
      speed: Math.min(this.player.horizontalSpeed / MOVE.maxSpeed, 1),
      onGround: this.player.onGround,
      mouseDX: mouse.dx,
      mouseDY: mouse.dy,
      reload: this.weapons.reloadProgress,
      draw: this.weapons.drawProgress,
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
    this.hud.setDeath(this.killer, this.respawnTimer);

    const { def, ammo, reserve } = this.weapons.current;
    this.hud.setAmmo(def.name, ammo, reserve);
  }

  private resize(): void {
    const { innerWidth: width, innerHeight: height } = window;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.viewModel.resize(width / height);
    this.renderer.setSize(width, height);
  }
}
