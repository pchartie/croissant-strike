import type { HitPart } from '../bots/BotModel';
import type { GrenadeType } from '../grenades/definitions';
import type { WeaponId } from '../weapons/definitions';

/** Change quand le protocole change : deux versions différentes du jeu ne jouent pas ensemble. */
export const PROTOCOL_VERSION = 2;

export type Vec3 = [number, number, number];

/**
 * Messages échangés entre les deux joueurs. Chacun fait autorité sur lui-même :
 * il envoie sa position, annonce ses tirs et les touches qu'il a vues ; celui
 * qui est touché applique les dégâts (avec son gilet) et annonce sa mort.
 */
export type NetMessage =
  /** Premier message de chaque côté. */
  | { t: 'hello'; version: number; name: string }
  /** Position et visée, ~30 fois par seconde. */
  | {
      t: 'state';
      /** Pieds. */
      p: Vec3;
      yaw: number;
      pitch: number;
      /** Hauteur des yeux (plus basse accroupi). */
      eye: number;
      ground: boolean;
      weapon: WeaponId;
      alive: boolean;
    }
  /** Un tir (sons, traînées) : départ et point d'arrivée de chaque balle ou plomb. */
  | { t: 'shot'; weapon: WeaponId; from: Vec3; ends: Vec3[] }
  /** Coup de couteau dans le vide ou dans un mur (pour le son). */
  | { t: 'swing'; heavy: boolean }
  /** « Je t'ai touché » : dégâts bruts (avant le gilet), déjà réduits par la distance. */
  | { t: 'hit'; weapon: WeaponId; part: HitPart; damage: number; label?: string }
  /** « Tu m'as tué » : envoyé par la victime au tireur. */
  | { t: 'died'; weapon: string; headshot: boolean }
  /** Grenade lancée : l'autre la fait voler de son côté. */
  | { t: 'grenade'; type: GrenadeType; id: number; from: Vec3; velocity: Vec3 }
  /** La grenade `id` a éclaté là (l'autre la fait éclater au même endroit). */
  | { t: 'detonate'; id: number; at: Vec3 };

export const toVec3 = (v: { x: number; y: number; z: number }): Vec3 => [round(v.x), round(v.y), round(v.z)];

/** Arrondi au millimètre : des messages plus courts. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Vérifie la forme d'un message reçu (l'autre joueur peut avoir une autre version du jeu). */
export function isMessage(data: unknown): data is NetMessage {
  if (!data || typeof data !== 'object') return false;
  const t = (data as { t?: unknown }).t;
  return t === 'hello' || t === 'state' || t === 'shot' || t === 'swing' || t === 'hit' || t === 'died' || t === 'grenade' || t === 'detonate';
}
