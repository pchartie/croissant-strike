import { DEFAULT_BINDINGS, validateBindings, type Bindings } from './bindings';

export type GameMode = 'deathmatch' | 'rounds';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type CrosshairColor = 'green' | 'white' | 'red' | 'cyan' | 'yellow';
export type CrosshairSize = 'small' | 'medium' | 'large';
export type ShadowQuality = 'off' | 'low' | 'high';

export interface Settings {
  // Jeu
  /** Deathmatch : réapparition en continu. Manches : une vie par manche, comme dans CS. */
  mode: GameMode;
  botsEnabled: boolean;
  botsAggressive: boolean;
  botCount: number;
  allyCount: number;
  difficulty: Difficulty;
  // Contrôles
  /** Sensibilité façon CS : degrés par point de souris = 0,022 × sensibilité. */
  sensitivity: number;
  invertY: boolean;
  /** Champ de vision vertical, en degrés. */
  fov: number;
  // Audio et affichage
  /** Volume général, de 0 à 100. */
  volume: number;
  crosshairColor: CrosshairColor;
  crosshairSize: CrosshairSize;
  showSpeed: boolean;
  // Graphismes
  shadows: ShadowQuality;
  /** Résolution de rendu, en % de celle de l'écran (moins = plus fluide). */
  renderScale: number;
  showFps: boolean;
  /** Touches de chaque action (onglet « Touches »). */
  bindings: Bindings;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'deathmatch',
  botsEnabled: true,
  botsAggressive: true,
  botCount: 5,
  allyCount: 0,
  difficulty: 'normal',
  sensitivity: 2,
  invertY: true,
  fov: 75,
  volume: 70,
  crosshairColor: 'green',
  crosshairSize: 'medium',
  showSpeed: true,
  shadows: 'high',
  renderScale: 100,
  showFps: false,
  bindings: DEFAULT_BINDINGS,
};

/** Réglages simples, décrits par SETTINGS_TABS (les touches ont leur propre onglet). */
type Key = Exclude<keyof Settings, 'bindings'>;

/** Description d'un réglage : le panneau est construit à partir de ces descriptions. */
export type SettingField =
  | { key: Key; label: string; type: 'toggle'; on: string; off: string }
  | { key: Key; label: string; type: 'choice'; options: { value: string; label: string }[] }
  | { key: Key; label: string; type: 'range'; min: number; max: number; step: number; unit?: string };

export interface SettingsTab {
  title: string;
  fields: SettingField[];
}

export const SETTINGS_TABS: SettingsTab[] = [
  {
    title: 'Jeu',
    fields: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'choice',
        options: [
          { value: 'deathmatch', label: 'Deathmatch' },
          { value: 'rounds', label: 'Manches' },
        ],
      },
      { key: 'botsEnabled', label: 'Bots', type: 'toggle', on: 'Activés', off: 'Désactivés' },
      { key: 'botsAggressive', label: 'Comportement', type: 'toggle', on: 'Agressifs', off: 'Passifs' },
      { key: 'botCount', label: "Nombre d'ennemis", type: 'range', min: 1, max: 10, step: 1 },
      { key: 'allyCount', label: 'Coéquipiers', type: 'range', min: 0, max: 4, step: 1 },
      {
        key: 'difficulty',
        label: 'Difficulté',
        type: 'choice',
        options: [
          { value: 'easy', label: 'Facile' },
          { value: 'normal', label: 'Normale' },
          { value: 'hard', label: 'Difficile' },
        ],
      },
    ],
  },
  {
    title: 'Contrôles',
    fields: [
      { key: 'sensitivity', label: 'Sensibilité', type: 'range', min: 0.2, max: 8, step: 0.1 },
      { key: 'invertY', label: 'Axe vertical', type: 'toggle', on: 'Inversé', off: 'Normal' },
      { key: 'fov', label: 'Champ de vision', type: 'range', min: 60, max: 100, step: 1, unit: '°' },
    ],
  },
  {
    title: 'Audio et affichage',
    fields: [
      { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 100, step: 1, unit: ' %' },
      {
        key: 'crosshairColor',
        label: 'Couleur du réticule',
        type: 'choice',
        options: [
          { value: 'green', label: 'Vert' },
          { value: 'white', label: 'Blanc' },
          { value: 'red', label: 'Rouge' },
          { value: 'cyan', label: 'Cyan' },
          { value: 'yellow', label: 'Jaune' },
        ],
      },
      {
        key: 'crosshairSize',
        label: 'Taille du réticule',
        type: 'choice',
        options: [
          { value: 'small', label: 'Petit' },
          { value: 'medium', label: 'Moyen' },
          { value: 'large', label: 'Grand' },
        ],
      },
      { key: 'showSpeed', label: 'Compteur de vitesse', type: 'toggle', on: 'Affiché', off: 'Caché' },
    ],
  },
  {
    title: 'Graphismes',
    fields: [
      {
        key: 'shadows',
        label: 'Ombres',
        type: 'choice',
        options: [
          { value: 'off', label: 'Désactivées' },
          { value: 'low', label: 'Basses' },
          { value: 'high', label: 'Hautes' },
        ],
      },
      { key: 'renderScale', label: 'Résolution de rendu', type: 'range', min: 50, max: 100, step: 5, unit: ' %' },
      { key: 'showFps', label: 'Images par seconde', type: 'toggle', on: 'Affichées', off: 'Cachées' },
    ],
  },
];

/** Ces réglages n'ont pas de sens sans bots : ils sont grisés quand les bots sont désactivés. */
export function isFieldEnabled(key: Key, settings: Settings): boolean {
  const needsBots: Key[] = ['botsAggressive', 'botCount', 'allyCount', 'difficulty'];
  return !needsBots.includes(key) || settings.botsEnabled;
}

const STORAGE_KEY = 'fps1.settings';

/** Réglages mémorisés dans le navigateur ; toute valeur absente ou invalide reprend sa valeur par défaut. */
export function loadSettings(): Settings {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    // Stockage illisible ou bloqué : réglages par défaut.
  }
  const settings: Settings = { ...DEFAULT_SETTINGS, bindings: validateBindings(stored.bindings) };
  for (const field of SETTINGS_TABS.flatMap((tab) => tab.fields)) {
    const value = validate(field, stored[field.key]);
    if (value !== undefined) (settings as Record<Key, unknown>)[field.key] = value;
  }
  return settings;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Navigation privée ou stockage bloqué : les réglages ne dureront que cette partie.
  }
}

function validate(field: SettingField, value: unknown): unknown {
  switch (field.type) {
    case 'toggle':
      return typeof value === 'boolean' ? value : undefined;
    case 'choice':
      return field.options.some((option) => option.value === value) ? value : undefined;
    case 'range':
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      return Math.min(field.max, Math.max(field.min, Math.round(value / field.step) * field.step));
  }
}
