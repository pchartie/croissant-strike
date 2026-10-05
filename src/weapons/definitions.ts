export type WeaponId = 'rifle' | 'pistol';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Touche du clavier (1, 2…) pour sortir l'arme. */
  slot: number;
  automatic: boolean;
  damage: number;
  /** Secondes entre deux tirs. */
  fireInterval: number;
  magazine: number;
  reserve: number;
  reloadTime: number;
  drawTime: number;
  range: number;
  /** Imprécision, en radians (rayon du cône de dispersion). */
  spread: {
    base: number;
    /** Ajouté à pleine vitesse de course, proportionnellement à la vitesse. */
    moving: number;
    air: number;
    /** Ajouté à chaque balle d'une rafale, jusqu'à `maxShots` balles. */
    perShot: number;
    maxShots: number;
  };
  recoil: {
    /** Recul après chaque tir, en degrés : [vers le haut, vers la droite]. La dernière valeur se répète. */
    pattern: [number, number][];
    /** Variation aléatoire gauche/droite ajoutée à chaque tir, en degrés. */
    random: number;
    /** Vitesse de retour du viseur une fois le tir arrêté (par seconde). */
    recovery: number;
  };
  /** Recul visuel de l'arme en main. */
  viewKick: { back: number; pitch: number };
  sound: { cutoff: number; thump: number; decay: number; volume: number };
}

function repeat(times: number, kick: [number, number]): [number, number][] {
  return Array.from({ length: times }, () => kick);
}

export const RIFLE: WeaponDef = {
  id: 'rifle',
  name: 'AK-47',
  slot: 1,
  automatic: true,
  damage: 36,
  fireInterval: 0.1,
  magazine: 30,
  reserve: 90,
  reloadTime: 2.5,
  drawTime: 0.9,
  range: 200,
  spread: { base: 0.004, moving: 0.08, air: 0.25, perShot: 0.0015, maxShots: 10 },
  recoil: {
    // Rafale façon AK de CS : monte fort, part à gauche, puis à droite, puis à gauche.
    pattern: [
      [0.55, 0.05], [0.8, -0.05], [1.0, 0.1], [1.05, 0], [0.95, -0.1],
      [0.85, 0.1], [0.7, 0], [0.5, -0.1], [0.3, 0],
      ...repeat(8, [0.1, -0.45]),
      ...repeat(6, [0.05, 0.6]),
      ...repeat(6, [0, -0.4]),
    ],
    random: 0.15,
    recovery: 5,
  },
  viewKick: { back: 0.045, pitch: 0.06 },
  sound: { cutoff: 2600, thump: 110, decay: 0.32, volume: 0.9 },
};

export const PISTOL: WeaponDef = {
  id: 'pistol',
  name: 'USP',
  slot: 2,
  automatic: false,
  damage: 35,
  fireInterval: 0.15,
  magazine: 12,
  reserve: 24,
  reloadTime: 2.2,
  drawTime: 0.6,
  range: 120,
  spread: { base: 0.006, moving: 0.03, air: 0.15, perShot: 0.004, maxShots: 6 },
  recoil: {
    pattern: [[1.4, 0.2], [1.6, -0.3], [1.8, 0.3]],
    random: 0.5,
    recovery: 8,
  },
  viewKick: { back: 0.03, pitch: 0.12 },
  sound: { cutoff: 4200, thump: 160, decay: 0.2, volume: 0.7 },
};

export const LOADOUT: WeaponDef[] = [RIFLE, PISTOL];
