// Valeurs reprises de Counter-Strike: Source, converties des unités Source
// (1 unité ≈ 2,54 cm) en mètres.
export const UNIT = 0.0254;

export const TICK_RATE = 128;
export const TICK = 1 / TICK_RATE;

export const PLAYER = {
  radius: 16 * UNIT,
  height: 72 * UNIT,
  eyeHeight: 64 * UNIT,
  /** Accroupi : boîte plus basse et yeux plus bas. */
  duckHeight: 54 * UNIT,
  duckEyeHeight: 46 * UNIT,
};

export const MOVE = {
  maxSpeed: 250 * UNIT,
  accelerate: 5, // sv_accelerate
  airAccelerate: 10, // sv_airaccelerate
  airSpeedCap: 30 * UNIT,
  friction: 4, // sv_friction
  stopSpeed: 75 * UNIT, // sv_stopspeed
  gravity: 800 * UNIT, // sv_gravity
  jumpSpeed: 301.99 * UNIT, // saut de 57 unités de haut
  stepSize: 18 * UNIT, // sv_stepsize : hauteur de marche franchie sans sauter
  /** Vitesse en marchant (Maj) et accroupi, par rapport à la course. */
  walkSpeedScale: 0.52,
  duckSpeedScale: 0.34,
  /** Temps pour s'accroupir ou se relever, en secondes. */
  duckTime: 0.2,
};

export const BOTS = {
  count: 5,
  health: 100,
  respawnDelay: 5,
  /** Temps avant de tirer après avoir repéré le joueur, en secondes. */
  reactionTime: 0.6,
  /** Erreur de visée au moment où le bot repère le joueur, puis une fois stabilisé, en degrés. */
  aimErrorStart: 7,
  aimErrorSettled: 2.2,
  /** Temps pour passer de l'erreur de départ à l'erreur stabilisée, en secondes. */
  aimSettleTime: 1.2,
  /** Vitesse de rotation maximale, en degrés par seconde. */
  turnSpeed: 300,
  headshotChance: 0.1,
  visionRange: 60,
  /** Champ de vision total, en degrés. */
  visionAngle: 150,
  /** Distance à laquelle un bot entend tirer le joueur. */
  hearingRange: 25,
};

/**
 * Préréglages de difficulté des bots (réglage « Difficulté ») : ils remplacent
 * les valeurs correspondantes de BOTS.
 */
export const DIFFICULTY = {
  easy: { reactionTime: 0.85, aimErrorStart: 9, aimErrorSettled: 3.5, aimSettleTime: 1.6, turnSpeed: 200, headshotChance: 0.05 },
  normal: { reactionTime: 0.6, aimErrorStart: 7, aimErrorSettled: 2.2, aimSettleTime: 1.2, turnSpeed: 300, headshotChance: 0.1 },
  hard: { reactionTime: 0.35, aimErrorStart: 5, aimErrorSettled: 1.2, aimSettleTime: 0.8, turnSpeed: 420, headshotChance: 0.25 },
};

export const ROUNDS = {
  /** Gel au début de chaque manche (on peut regarder autour, pas bouger). */
  freezeTime: 3,
  /** Durée d'une manche : 1:55, comme dans CS:GO. */
  roundTime: 115,
  /** Pause après une manche, puis après le match. */
  roundOverTime: 5,
  matchOverTime: 8,
  /** Manches à gagner pour remporter le match. */
  toWin: 5,
};

export const CAMERA = {
  fov: 75,
  // Sensibilité par défaut : 0,022 × 2 degrés par point de souris, comme dans CS (réglable dans le menu).
  sensitivity: (0.022 * 2 * Math.PI) / 180,
};
