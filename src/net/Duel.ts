import * as THREE from 'three';
import type { HitPart } from '../bots/BotModel';
import { GRENADES, type GrenadeType } from '../grenades/definitions';
import type { Player } from '../player/Player';
import { OnlinePanel } from '../ui/OnlinePanel';
import { WEAPONS, type WeaponDef, type WeaponId } from '../weapons/definitions';
import { Online } from './Online';
import { toVec3, type NetMessage, type Vec3 } from './protocol';
import { RemotePlayer } from './RemotePlayer';

/** Position envoyée 30 fois par seconde. */
const STATE_INTERVAL_MS = 1000 / 30;

/** Ce que le jeu fait quand quelque chose arrive de l'autre joueur. */
export interface DuelHooks {
  /** La partie commence (connexion établie) ou s'arrête (`null` : retour au jeu seul, avec un message). */
  started(opponent: string): void;
  ended(message: string | null): void;
  /** L'adversaire tire : départ et arrivée de chaque balle. */
  remoteShot(def: WeaponDef, from: THREE.Vector3, ends: THREE.Vector3[]): void;
  remoteSwing(heavy: boolean): void;
  /** L'adversaire annonce nous avoir touché. */
  hitByRemote(def: WeaponDef, part: HitPart, damage: number, label: string | undefined): void;
  /** L'adversaire annonce que notre tir l'a tué. */
  killedRemote(weapon: string, headshot: boolean): void;
  /** L'adversaire lance une grenade, puis annonce où elle éclate. */
  remoteGrenade(type: GrenadeType, id: number, from: THREE.Vector3, velocity: THREE.Vector3): void;
  remoteDetonate(id: number, at: THREE.Vector3): void;
}

/**
 * Partie en ligne en 1 contre 1 : la connexion, l'adversaire affiché, et les
 * messages dans les deux sens.
 */
export class Duel {
  readonly online = new Online();
  readonly remote: RemotePlayer;
  private lastState = 0;

  constructor(
    scene: THREE.Scene,
    private readonly player: Player,
    private readonly hooks: DuelHooks,
  ) {
    this.remote = new RemotePlayer(scene);
    new OnlinePanel(document.getElementById('online')!, this.online);
    this.online.onMessage((message) => this.receive(message));
    let wasConnected = false;
    this.online.onStatus((status) => {
      if (status.kind === 'connected' && !wasConnected) {
        this.remote.name = status.opponent;
        hooks.started(status.opponent);
      } else if (status.kind !== 'connected' && wasConnected) {
        this.remote.reset();
        hooks.ended(status.kind === 'error' ? status.message : null);
      }
      wasConnected = status.kind === 'connected';
    });
  }

  get active(): boolean {
    return this.online.connected;
  }

  /** À chaque image : place l'adversaire et envoie notre position (même en pause, pour ne pas « disparaître »). */
  update(dt: number, weapon: WeaponId): void {
    if (!this.active) return;
    this.remote.update(dt);
    const now = performance.now();
    if (now - this.lastState < STATE_INTERVAL_MS) return;
    this.lastState = now;
    const { player } = this;
    this.online.send({
      t: 'state',
      p: toVec3(player.position),
      yaw: round(player.yaw),
      pitch: round(player.pitch),
      eye: round(player.eyeHeight),
      ground: player.onGround,
      weapon,
      alive: player.alive,
    });
  }

  sendShot(def: WeaponDef, from: THREE.Vector3, ends: THREE.Vector3[]): void {
    this.online.send({ t: 'shot', weapon: def.id, from: toVec3(from), ends: ends.map(toVec3) });
  }

  sendSwing(heavy: boolean): void {
    this.online.send({ t: 'swing', heavy });
  }

  sendHit(def: WeaponDef, part: HitPart, damage: number, label?: string): void {
    this.online.send({ t: 'hit', weapon: def.id, part, damage: Math.round(damage * 10) / 10, label });
  }

  sendGrenade(type: GrenadeType, id: number, from: THREE.Vector3, velocity: THREE.Vector3): void {
    this.online.send({ t: 'grenade', type, id, from: toVec3(from), velocity: toVec3(velocity) });
  }

  sendDetonate(id: number, at: THREE.Vector3): void {
    this.online.send({ t: 'detonate', id, at: toVec3(at) });
  }

  sendDeath(weapon: string, headshot: boolean): void {
    this.online.send({ t: 'died', weapon, headshot });
  }

  private receive(message: NetMessage): void {
    switch (message.t) {
      case 'state':
        if (isVec3(message.p) && [message.yaw, message.pitch, message.eye].every(Number.isFinite)) this.remote.receive(message);
        break;
      case 'shot': {
        const def = weaponOf(message.weapon);
        if (!def || !isVec3(message.from) || !Array.isArray(message.ends) || !message.ends.every(isVec3)) return;
        this.remote.showFlash();
        this.hooks.remoteShot(def, toVector(message.from), message.ends.slice(0, 16).map(toVector));
        break;
      }
      case 'swing':
        this.hooks.remoteSwing(message.heavy);
        break;
      case 'hit': {
        const def = weaponOf(message.weapon);
        // On ne croit pas des dégâts impossibles (message abîmé ou version trafiquée).
        if (!def || !(message.damage > 0) || message.damage > 500) return;
        if (message.part !== 'head' && message.part !== 'body' && message.part !== 'legs') return;
        this.hooks.hitByRemote(def, message.part, message.damage, message.label?.slice(0, 40));
        break;
      }
      case 'grenade':
        if (!Object.hasOwn(GRENADES, message.type) || !Number.isInteger(message.id) || !isVec3(message.from) || !isVec3(message.velocity)) return;
        // Vitesse plafonnée : un lancer de grenade, pas un missile.
        if (Math.hypot(...message.velocity) > 50) return;
        this.hooks.remoteGrenade(message.type, message.id, toVector(message.from), toVector(message.velocity));
        break;
      case 'detonate':
        if (Number.isInteger(message.id) && isVec3(message.at)) this.hooks.remoteDetonate(message.id, toVector(message.at));
        break;
      case 'died':
        this.hooks.killedRemote(String(message.weapon).slice(0, 40), message.headshot === true);
        break;
    }
  }
}

function weaponOf(id: unknown): WeaponDef | null {
  return typeof id === 'string' && Object.hasOwn(WEAPONS, id) ? WEAPONS[id as WeaponId] : null;
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function toVector(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
