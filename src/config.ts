// Valeurs reprises de Counter-Strike: Source, converties des unités Source
// (1 unité ≈ 2,54 cm) en mètres.
export const UNIT = 0.0254;

export const TICK_RATE = 128;
export const TICK = 1 / TICK_RATE;

export const PLAYER = {
  radius: 16 * UNIT,
  height: 72 * UNIT,
  eyeHeight: 64 * UNIT,
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
};

export const BOTS = {
  count: 3,
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

export const CAMERA = {
  fov: 75,
  // 0,022 × sensibilité 2, comme dans CS : degrés par point de souris.
  sensitivity: (0.022 * 2 * Math.PI) / 180,
};
