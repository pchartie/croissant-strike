import { UNIT } from '../config';

export type GrenadeType = 'he' | 'flash' | 'smoke' | 'molotov' | 'decoy';

export interface GrenadeDef {
  type: GrenadeType;
  name: string;
  /** Nom court pour le HUD. */
  short: string;
  /**
   * Explosion au bout de ce temps (secondes). Fumigène et leurre : temps
   * minimal, ils attendent en plus d'être immobiles. Molotov : explose au
   * premier contact avec le sol, sinon au bout de ce temps.
   */
  fuse: number;
  /** Couleur du modèle (en main et en vol). */
  color: number;
}

export const GRENADES: Record<GrenadeType, GrenadeDef> = {
  he: { type: 'he', name: 'Grenade HE', short: 'HE', fuse: 1.5, color: 0x4b5a32 },
  flash: { type: 'flash', name: 'Flash', short: 'Flash', fuse: 1.5, color: 0x9aa0a6 },
  smoke: { type: 'smoke', name: 'Fumigène', short: 'Fumi', fuse: 1.5, color: 0x6f8a94 },
  molotov: { type: 'molotov', name: 'Molotov', short: 'Molo', fuse: 2, color: 0x7a4a1c },
  decoy: { type: 'decoy', name: 'Leurre', short: 'Leurre', fuse: 2, color: 0x3a3c40 },
};

/** Ordre de défilement avec la touche 4, comme dans CS:GO. */
export const GRENADE_ORDER: GrenadeType[] = ['he', 'flash', 'smoke', 'molotov', 'decoy'];

/** Ce qu'on peut porter au plus quand on achète (CS:GO) : une par type, deux flashs, quatre en tout. */
export const GRENADE_CARRY = {
  perType: { he: 1, flash: 2, smoke: 1, molotov: 1, decoy: 1 } as Record<GrenadeType, number>,
  total: 4,
};

/** Grenades offertes à chaque réapparition en deathmatch (la limite d'achat ne s'y applique pas). */
export const GRENADE_LOADOUT: Record<GrenadeType, number> = { he: 1, flash: 2, smoke: 1, molotov: 1, decoy: 1 };

/** Valeurs reprises de CS:GO (unités Source converties en mètres). */
export const GRENADE_PHYSICS = {
  /** Vitesse de lancer : 750 × 0,9 unités/s, multipliée selon le bouton (gauche 1, les deux 0,65, droit 0,3). */
  throwSpeed: 750 * 0.9 * UNIT,
  /** Part de la vitesse du joueur transmise à la grenade. */
  inheritVelocity: 1.25,
  /** Les grenades tombent avec 40 % de la gravité normale. */
  gravity: 0.4 * 800 * UNIT,
  elasticity: 0.45,
  friction: 0.2,
  radius: 0.05,
};

export const HE = {
  damage: 98,
  /** Rayon des dégâts : 350 unités. */
  radius: 350 * UNIT,
};

export const FLASH = {
  /** Aveuglement maximal, face à la flash et tout près. */
  maxDuration: 4.9,
  /** Pleine puissance jusqu'à cette distance, puis baisse jusqu'à `range`. */
  fullRange: 6,
  range: 35,
};

export const SMOKE = {
  /** Rayon du nuage : 144 unités. */
  radius: 144 * UNIT,
  duration: 18,
  growTime: 1.2,
  fadeTime: 3,
};

export const MOLOTOV = {
  radius: 3,
  duration: 7,
  damagePerSecond: 40,
};

export const DECOY = {
  duration: 15,
  /** Petite explosion finale. */
  damage: 5,
  radius: 2,
};
