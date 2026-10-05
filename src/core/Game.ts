import * as THREE from 'three';
import { CAMERA, MOVE, TICK, UNIT } from '../config';
import { Player } from '../player/Player';
import { Hud } from '../ui/Hud';
import { Impacts } from '../weapons/Impacts';
import { ViewModel } from '../weapons/ViewModel';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { buildArena, SPAWN } from '../world/Arena';
import { World } from '../world/World';
import { Audio } from './Audio';
import { Input } from './Input';

const MAX_FRAME_TIME = 0.1;
const MUZZLE_LIGHT_DURATION = 0.04;

export class Game {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.05, 500);
  private readonly input: Input;
  private readonly world = new World(this.scene);
  private readonly player = new Player(this.world);
  private readonly hud: Hud;
  private readonly audio = new Audio();
  private readonly viewModel = new ViewModel();
  private readonly impacts = new Impacts(this.scene);
  private readonly weapons: WeaponSystem;

  /** Éclaire brièvement les alentours à chaque tir. */
  private readonly muzzleLight = new THREE.PointLight(0xffb060, 0, 8, 2);
  private muzzleLightTimer = 0;
  private readonly forward = new THREE.Vector3();

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

    buildArena(this.world, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.muzzleLight);
    this.player.spawn(SPAWN.position, SPAWN.yaw);

    this.weapons = new WeaponSystem(this.player, this.world, {
      fired: (def, hit) => {
        this.viewModel.kick(def);
        this.audio.shot(def);
        this.muzzleLightTimer = MUZZLE_LIGHT_DURATION;
        if (hit) this.impacts.add(hit);
      },
      reloadStarted: (def) => this.audio.reload(def),
      drawn: (def) => {
        this.viewModel.show(def.id);
        this.audio.draw();
      },
      dryFired: () => this.audio.dryFire(),
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
    this.player.look(mouse.dx, mouse.dy);

    // Physique à pas fixe, indépendante du nombre d'images par seconde.
    if (this.input.locked) {
      this.accumulator += frameTime;
      while (this.accumulator >= TICK) {
        this.player.update(TICK, this.input);
        if (this.player.outOfMap) this.player.spawn(SPAWN.position, SPAWN.yaw);
        this.weapons.update(TICK, this.input);
        this.input.endTick();
        this.accumulator -= TICK;
      }
    }

    this.player.applyToCamera(this.camera, this.accumulator / TICK, this.weapons.punch);
    this.updateEffects(frameTime, mouse);
    this.updateHud();

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.viewModel.scene, this.viewModel.camera);
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

    this.muzzleLightTimer -= dt;
    this.muzzleLight.intensity = this.muzzleLightTimer > 0 ? 25 : 0;
    this.camera.getWorldDirection(this.forward);
    this.muzzleLight.position.copy(this.camera.position).addScaledVector(this.forward, 0.8);
  }

  private updateHud(): void {
    this.hud.setSpeed(this.player.horizontalSpeed / UNIT);

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
