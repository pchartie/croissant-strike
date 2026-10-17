import { CROSSHAIR_COLORS } from '../ui/crosshair';
import { DEFAULT_BINDINGS, validateBindings, type Bindings } from './bindings';
import type { MapId } from '../world/maps';

export type GameMode = 'deathmatch' | 'rounds';
/** Passif : les bots se promènent sans attaquer (entraînement à la visée) ; sinon ils combattent. */
export type Difficulty = 'passive' | 'easy' | 'normal' | 'hard';
export type CrosshairColor = 'green' | 'white' | 'red' | 'cyan' | 'yellow';
export type CrosshairSize = 'small' | 'medium' | 'large';

export interface Settings {
  // Jeu
  /** Carte (en changer recharge la page). */
  map: MapId;
  /** Deathmatch : réapparition en continu. Manches : une vie par manche, comme dans CS. */
  mode: GameMode;
  botsEnabled: boolean;
  /** Taille des équipes, comme dans CS : N ennemis contre toi et N − 1 coéquipiers. */
  botCount: number;
  difficulty: Difficulty;
  // Contrôles
  /** Sensibilité façon CS : degrés par point de souris = 0,022 × sensibilité. */
  sensitivity: number;
  invertY: boolean;
  /** Champ de vision vertical, en degrés (plus de réglage : toujours 75). */
  fov: number;
  // Audio et affichage
  /** Volume général, de 0 à 100. */
  volume: number;
  crosshairColor: CrosshairColor;
  crosshairSize: CrosshairSize;
  // Graphismes
  /** Résolution de rendu, en % de celle de l'écran (moins = plus fluide). */
  renderScale: number;
  showFps: boolean;
  /** Touches de chaque action (onglet « Touches »). */
  bindings: Bindings;
}

export const DEFAULT_SETTINGS: Settings = {
  map: 'dunes',
  mode: 'deathmatch',
  botsEnabled: true,
  botCount: 3,
  // Passifs par défaut : on découvre la carte et on s'entraîne à viser sans se faire tirer dessus.
  difficulty: 'passive',
  sensitivity: 2,
  invertY: true,
  fov: 75,
  volume: 70,
  crosshairColor: 'green',
  crosshairSize: 'medium',
  renderScale: 100,
  showFps: true,
  bindings: DEFAULT_BINDINGS,
};

/** Réglages simples, décrits par SETTINGS_TABS (les touches ont leur propre onglet). */
type Key = Exclude<keyof Settings, 'bindings'>;

/** Description d'un réglage : le panneau est construit à partir de ces descriptions. */
export type SettingField =
  | { key: Key; label: string; type: 'toggle'; on: string; off: string }
  /** `swatch` : pastille de couleur devant le libellé. */
  | { key: Key; label: string; type: 'choice'; options: { value: string; label: string; swatch?: string }[] }
  /** Aperçu du réticule (couleur et taille choisies), sans valeur propre. */
  | { key: Key; label: string; type: 'crosshair' }
  /** Grandes cartes avec une image (choix de la carte de jeu). `image` : chemin depuis la racine du site. */
  | { key: Key; label: string; type: 'cards'; hint?: string; options: { value: string; label: string; description: string; image: string }[] }
  | { key: Key; label: string; type: 'range'; min: number; max: number; step: number; unit?: string; format?: (value: number) => string };

export interface SettingsTab {
  title: string;
  fields: SettingField[];
}

export const SETTINGS_TABS: SettingsTab[] = [
  {
    title: 'Partie',
    fields: [
      {
        key: 'map',
        label: 'Carte',
        type: 'cards',
        hint: 'La carte choisie se charge quand tu cliques sur le bouton en bas.',
        options: [
          { value: 'dunes', label: 'Dunes', description: 'Carte grise « squelette »', image: 'maps/dunes/preview.webp' },
          { value: 'medina', label: 'Médina', description: 'Vieille ville du Maghreb', image: 'maps/medina/preview.webp' },
        ],
      },
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
      {
        key: 'botCount',
        label: 'Nombre de bots',
        type: 'range',
        min: 1,
        max: 5,
        step: 1,
        format: (n) => `${n} contre ${n}`,
      },
      {
        key: 'difficulty',
        label: 'Difficulté',
        type: 'choice',
        options: [
          { value: 'passive', label: 'Passif' },
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
          { value: 'green', label: 'Vert', swatch: CROSSHAIR_COLORS.green },
          { value: 'white', label: 'Blanc', swatch: CROSSHAIR_COLORS.white },
          { value: 'red', label: 'Rouge', swatch: CROSSHAIR_COLORS.red },
          { value: 'cyan', label: 'Cyan', swatch: CROSSHAIR_COLORS.cyan },
          { value: 'yellow', label: 'Jaune', swatch: CROSSHAIR_COLORS.yellow },
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
      { key: 'crosshairColor', label: 'Aperçu', type: 'crosshair' },
    ],
  },
  {
    title: 'Graphismes',
    fields: [
      { key: 'renderScale', label: 'Résolution de rendu', type: 'range', min: 50, max: 100, step: 5, unit: ' %' },
      { key: 'showFps', label: 'Images par seconde', type: 'toggle', on: 'Affichées', off: 'Cachées' },
    ],
  },
];

/** Ces réglages n'ont pas de sens sans bots : ils sont grisés quand les bots sont désactivés. */
export function isFieldEnabled(key: Key, settings: Settings): boolean {
  const needsBots: Key[] = ['botCount', 'difficulty'];
  return !needsBots.includes(key) || settings.botsEnabled;
}

const STORAGE_KEY = 'fps1.settings';
/** Révision des réglages : un réglage listé ici reprend une fois sa valeur par défaut quand elle a changé. */
const REVISION = 4;
const RESET_AT: Partial<Record<Key, number>> = { showFps: 2, botCount: 3, difficulty: 4 };

/** Réglages mémorisés dans le navigateur ; toute valeur absente ou invalide reprend sa valeur par défaut. */
export function loadSettings(): Settings {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    // Stockage illisible ou bloqué : réglages par défaut.
  }
  const settings: Settings = { ...DEFAULT_SETTINGS, bindings: validateBindings(stored.bindings) };
  const revision = typeof stored.revision === 'number' ? stored.revision : 1;
  for (const field of SETTINGS_TABS.flatMap((tab) => tab.fields)) {
    if (revision < (RESET_AT[field.key] ?? 0)) continue;
    const value = validate(field, stored[field.key]);
    if (value !== undefined) (settings as Record<Key, unknown>)[field.key] = value;
  }
  return settings;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, revision: REVISION }));
  } catch {
    // Navigation privée ou stockage bloqué : les réglages ne dureront que cette partie.
  }
}

function validate(field: SettingField, value: unknown): unknown {
  switch (field.type) {
    case 'toggle':
      return typeof value === 'boolean' ? value : undefined;
    case 'choice':
    case 'cards':
      return field.options.some((option) => option.value === value) ? value : undefined;
    case 'crosshair':
      return undefined;
    case 'range':
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      return Math.min(field.max, Math.max(field.min, Math.round(value / field.step) * field.step));
  }
}
