import * as THREE from 'three';
import { CAMERA, TICK, UNIT } from '../config';
import { Player } from '../player/Player';
import { Hud } from '../ui/Hud';
import { buildArena, SPAWN } from '../world/Arena';
import { World } from '../world/World';
import { Input } from './Input';

const MAX_FRAME_TIME = 0.1;

export class Game {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.05, 500);
  private readonly input: Input;
  private readonly world = new World(this.scene);
  private readonly player = new Player(this.world);
  private readonly hud: Hud;

  private accumulator = 0;
  private lastTime = 0;

  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.input = new Input(this.renderer.domElement);
    this.hud = new Hud(() => this.input.requestLock());
    this.input.onLockChange((locked) => this.hud.setPaused(!locked));

    buildArena(this.world, this.renderer.capabilities.getMaxAnisotropy());
    this.player.spawn(SPAWN.position, SPAWN.yaw);

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
        this.accumulator -= TICK;
      }
    }

    this.player.applyToCamera(this.camera, this.accumulator / TICK);
    this.hud.setSpeed(this.player.horizontalSpeed / UNIT);
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const { innerWidth: width, innerHeight: height } = window;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}
