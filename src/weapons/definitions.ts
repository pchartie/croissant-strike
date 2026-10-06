export type WeaponId = 'rifle' | 'smg' | 'shotgun' | 'pistol' | 'knife';

/** Une attaque au couteau. */
export interface MeleeAttack {
  damage: number;
  /** Dégâts dans le dos. */
  backstab: number;
  /** Portée, en mètres. */
  range: number;
  /** Temps avant de pouvoir frapper à nouveau. */
  interval: number;
  /** Délai entre le clic et le moment où la lame touche (animation). */
  delay: number;
}

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
  /** Part des dégâts qui passe un gilet pare-balles (pénétration de l'arme, CS:GO). */
  armorRatio: number;
  /** Prix au menu d'achat, et prime par élimination (valeurs de CS:GO). */
  price: number;
  killReward: number;
  /** Plombs par tir (fusil à pompe) ; 1 par défaut. */
  pellets?: number;
  /** Dégâts multipliés par ce nombre tous les 500 unités (12,7 m), comme le « range modifier » de CS. */
  rangeModifier?: number;
  /** Rechargement cartouche par cartouche (fusil à pompe) : durées du début, de chaque cartouche, de la fin. */
  shellReload?: { start: number; step: number; end: number };
  /** Arme de corps à corps : clic gauche rapide, clic droit puissant (pas de munitions). */
  melee?: {
    light: MeleeAttack & { /** Dégâts des coups enchaînés après une touche. */ followUp: number };
    heavy: MeleeAttack;
  };
}

function repeat(times: number, kick: [number, number]): [number, number][] {
  return Array.from({ length: times }, () => kick);
}

export const RIFLE: WeaponDef = {
  id: 'rifle',
  name: 'M4A1',
  slot: 1,
  automatic: true,
  damage: 36,
  fireInterval: 0.1,
  magazine: 30,
  reserve: 90,
  reloadTime: 3.0,
  drawTime: 0.9,
  range: 200,
  spread: { base: 0.004, moving: 0.08, air: 0.25, perShot: 0.0015, maxShots: 10 },
  recoil: {
    // Rafale façon CS : monte fort, part à gauche, puis à droite, puis à gauche.
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
  armorRatio: 0.7,
  price: 3100,
  killReward: 300,
  rangeModifier: 0.97,
};

export const PISTOL: WeaponDef = {
  id: 'pistol',
  name: 'M1911',
  slot: 2,
  automatic: false,
  damage: 35,
  fireInterval: 0.15,
  magazine: 12,
  reserve: 24,
  reloadTime: 1.8,
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
  armorRatio: 0.55,
  price: 200,
  killReward: 300,
  rangeModifier: 0.85,
};

/** Couteau de CS:GO : valeurs reprises du jeu (unités converties en mètres). */
export const KNIFE: WeaponDef = {
  id: 'knife',
  name: 'Couteau',
  slot: 3,
  automatic: true,
  damage: 40,
  fireInterval: 0.4,
  magazine: 0,
  reserve: 0,
  reloadTime: 0,
  drawTime: 0.75,
  range: 1.25,
  spread: { base: 0, moving: 0, air: 0, perShot: 0, maxShots: 0 },
  recoil: { pattern: [[0, 0]], random: 0, recovery: 10 },
  viewKick: { back: 0, pitch: 0 },
  sound: { cutoff: 0, thump: 0, decay: 0, volume: 0 },
  armorRatio: 0.85,
  price: 0,
  killReward: 1500,
  melee: {
    // Clic gauche : 40, puis 25 en enchaînant, 90 dans le dos ; portée 48 unités.
    light: { damage: 40, followUp: 25, backstab: 90, range: 48 * 0.0254, interval: 0.4, delay: 0.1 },
    // Clic droit : 65, 180 dans le dos (mortel) ; portée 32 unités.
    heavy: { damage: 65, backstab: 180, range: 32 * 0.0254 + 0.1, interval: 1.0, delay: 0.35 },
  },
};

/** MP5-SD de CS:GO : SMG silencieux, précis en mouvement, recul léger. */
export const SMG: WeaponDef = {
  id: 'smg',
  name: 'MP5-SD',
  slot: 1,
  automatic: true,
  damage: 27,
  fireInterval: 0.08,
  magazine: 30,
  reserve: 120,
  reloadTime: 2.8,
  drawTime: 0.67,
  range: 120,
  spread: { base: 0.006, moving: 0.035, air: 0.2, perShot: 0.0012, maxShots: 12 },
  recoil: {
    pattern: [
      [0.35, 0.05], [0.5, -0.05], [0.6, 0.08], [0.6, -0.06], [0.5, 0.05], [0.45, -0.08], [0.4, 0.06],
      ...repeat(6, [0.15, -0.25]),
      ...repeat(6, [0.08, 0.3]),
      ...repeat(10, [0.05, -0.2]),
    ],
    random: 0.12,
    recovery: 7,
  },
  viewKick: { back: 0.025, pitch: 0.035 },
  sound: { cutoff: 1800, thump: 90, decay: 0.18, volume: 0.5 },
  armorRatio: 0.6,
  price: 1500,
  killReward: 600,
  rangeModifier: 0.85,
};

/** Nova de CS:GO : fusil à pompe, 9 plombs, rechargé cartouche par cartouche. */
export const SHOTGUN: WeaponDef = {
  id: 'shotgun',
  name: 'Nova',
  slot: 1,
  automatic: false,
  damage: 26,
  fireInterval: 0.88,
  magazine: 8,
  reserve: 32,
  reloadTime: 0,
  drawTime: 1,
  range: 40,
  // Les plombs partent dans un cône fixe : c'est la dispersion de base.
  spread: { base: 0.045, moving: 0.03, air: 0.12, perShot: 0, maxShots: 0 },
  recoil: { pattern: [[2.6, 0.3]], random: 0.8, recovery: 4 },
  viewKick: { back: 0.07, pitch: 0.16 },
  sound: { cutoff: 1500, thump: 70, decay: 0.45, volume: 1 },
  armorRatio: 0.5,
  price: 1050,
  killReward: 900,
  pellets: 9,
  rangeModifier: 0.7,
  shellReload: { start: 0.45, step: 0.55, end: 0.7 },
};

/** Armes principales (touche 1), au menu d'achat. */
export const PRIMARIES: WeaponDef[] = [RIFLE, SMG, SHOTGUN];

export const LOADOUT: WeaponDef[] = [RIFLE, PISTOL, KNIFE];

/** Toutes les armes, par identifiant (pour le jeu en ligne). */
export const WEAPONS: Record<WeaponId, WeaponDef> = { rifle: RIFLE, smg: SMG, shotgun: SHOTGUN, pistol: PISTOL, knife: KNIFE };
