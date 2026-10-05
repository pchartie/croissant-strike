export type GameMode = 'deathmatch' | 'rounds';

export interface Settings {
  botsEnabled: boolean;
  botsAggressive: boolean;
  /** Deathmatch : réapparition en continu. Manches : une vie par manche, comme dans CS. */
  mode: GameMode;
}

const KEY = 'fps1.settings';
const DEFAULTS: Settings = { botsEnabled: true, botsAggressive: true, mode: 'deathmatch' };

/** Réglages mémorisés dans le navigateur d'une partie à l'autre. */
export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Navigation privée ou stockage bloqué : les réglages ne dureront que cette partie.
  }
}
