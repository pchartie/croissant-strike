/** Actions du joueur, chacune associée à une ou deux touches (clavier ou souris). */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'walk'
  | 'attack'
  | 'attack2'
  | 'reload'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'grenades'
  | 'nextWeapon'
  | 'prevWeapon'
  | 'buy'
  | 'scoreboard'
  | 'freezeBots';

/** Codes de touches : ceux du clavier (`KeyW`…), `Mouse0` à `Mouse4` et `Wheel` pour la molette. */
export type Bindings = Record<Action, string[]>;

/** Nombre de touches par action. */
export const BINDING_SLOTS = 2;

/** Groupes du menu des touches, dans l'ordre d'affichage. */
export const ACTION_GROUPS = ['Déplacements', 'Combat', 'Équipement', 'Interface'] as const;

/** Actions du menu des touches : nom court, précision éventuelle (en petit dessous) et groupe. */
export const ACTIONS: { action: Action; label: string; hint?: string; group: (typeof ACTION_GROUPS)[number] }[] = [
  { action: 'forward', label: 'Avancer', group: 'Déplacements' },
  { action: 'back', label: 'Reculer', group: 'Déplacements' },
  { action: 'left', label: 'Gauche', group: 'Déplacements' },
  { action: 'right', label: 'Droite', group: 'Déplacements' },
  { action: 'jump', label: 'Sauter', group: 'Déplacements' },
  { action: 'crouch', label: "S'accroupir", hint: 'Ctrl déconseillé : raccourcis du navigateur', group: 'Déplacements' },
  { action: 'walk', label: 'Marcher', hint: 'sans bruit', group: 'Déplacements' },
  { action: 'attack', label: 'Tirer', hint: 'grenade lancée loin · coup de couteau rapide', group: 'Combat' },
  { action: 'attack2', label: 'Action secondaire', hint: 'grenade en cloche · coup de couteau puissant', group: 'Combat' },
  { action: 'reload', label: 'Recharger', group: 'Combat' },
  { action: 'weapon1', label: 'Arme principale', group: 'Équipement' },
  { action: 'weapon2', label: 'Pistolet', group: 'Équipement' },
  { action: 'weapon3', label: 'Couteau', group: 'Équipement' },
  { action: 'grenades', label: 'Grenades', hint: 'appuyer à nouveau pour changer', group: 'Équipement' },
  { action: 'nextWeapon', label: 'Arme suivante', group: 'Équipement' },
  { action: 'prevWeapon', label: 'Arme précédente', group: 'Équipement' },
  { action: 'buy', label: "Menu d'achat", group: 'Interface' },
  { action: 'scoreboard', label: 'Tableau des scores', hint: 'maintenir', group: 'Interface' },
  { action: 'freezeBots', label: 'Figer les bots', hint: 'pour les inspecter ; appuyer à nouveau pour relancer', group: 'Interface' },
];

// Codes physiques : sur un clavier AZERTY, KeyW est la touche Z et KeyA la touche Q.
export const DEFAULT_BINDINGS: Bindings = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  // Pas Ctrl, contrairement à CS : le navigateur garde ses raccourcis même en jeu (Ctrl+W ferme
  // l'onglet en QWERTY, Ctrl+Maj+Q quitte le navigateur en AZERTY sous Windows).
  crouch: ['KeyC'],
  walk: ['ShiftLeft'],
  attack: ['Mouse0'],
  attack2: ['Mouse2'],
  reload: ['KeyR'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  grenades: ['Digit4'],
  // Comme dans CS : la molette fait défiler les armes et les grenades.
  nextWeapon: ['WheelDown'],
  prevWeapon: ['WheelUp'],
  buy: ['KeyB'],
  scoreboard: ['Tab'],
  freezeBots: ['KeyP'],
};

/** Touches qu'on ne peut pas assigner : Échap met le jeu en pause ; « Wheel » (ancienne molette sans sens) n'existe plus. */
export const RESERVED_CODES = ['Escape', 'Wheel'];

/** Anciennes touches par défaut remplacées depuis : une sauvegarde qui les a encore reprend les nouvelles. */
const OLD_DEFAULTS: Partial<Record<Action, string[]>> = { crouch: ['ControlLeft', 'KeyC'] };

/** Garde les touches valides d'une sauvegarde ; les actions absentes reprennent leurs touches par défaut. */
export function validateBindings(value: unknown): Bindings {
  const bindings = cloneBindings(DEFAULT_BINDINGS);
  if (!value || typeof value !== 'object') return bindings;
  for (const { action } of ACTIONS) {
    const codes = (value as Record<string, unknown>)[action];
    if (!Array.isArray(codes)) continue;
    const old = OLD_DEFAULTS[action];
    if (old && old.length === codes.length && old.every((code, i) => codes[i] === code)) continue;
    bindings[action] = codes
      .filter((code): code is string => typeof code === 'string' && code.length > 0 && !RESERVED_CODES.includes(code))
      .slice(0, BINDING_SLOTS);
  }
  return bindings;
}

export function cloneBindings(bindings: Bindings): Bindings {
  return Object.fromEntries(Object.entries(bindings).map(([action, codes]) => [action, [...codes]])) as Bindings;
}

const NAMES: Record<string, string> = {
  Space: 'Espace',
  ShiftLeft: 'Maj gauche',
  ShiftRight: 'Maj droite',
  ControlLeft: 'Ctrl gauche',
  ControlRight: 'Ctrl droit',
  AltLeft: 'Alt',
  AltRight: 'Alt Gr',
  Tab: 'Tab',
  CapsLock: 'Verr. maj',
  Enter: 'Entrée',
  Backspace: 'Retour arrière',
  ArrowUp: 'Flèche haut',
  ArrowDown: 'Flèche bas',
  ArrowLeft: 'Flèche gauche',
  ArrowRight: 'Flèche droite',
  Mouse0: 'Clic gauche',
  Mouse1: 'Clic molette',
  Mouse2: 'Clic droit',
  Mouse3: 'Souris 4',
  Mouse4: 'Souris 5',
  WheelUp: 'Molette haut',
  WheelDown: 'Molette bas',
};

/**
 * Nom lisible d'une touche. `layout` (carte du clavier fournie par le navigateur)
 * donne la vraie lettre selon la disposition : KeyW s'affiche « Z » en AZERTY.
 */
export function keyName(code: string, layout?: Map<string, string>): string {
  if (NAMES[code]) return NAMES[code];
  // Rangée des chiffres : « 1 » plutôt que « & » en AZERTY, comme on la désigne en jeu.
  if (code.startsWith('Digit')) return code.slice(5);
  const letter = layout?.get(code);
  if (letter && letter.trim()) return letter.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Pavé ${code.slice(6)}`;
  return code;
}

/**
 * Disposition du clavier devinée d'après la langue du navigateur, quand il ne la donne pas
 * (Firefox, Safari, Brave) : AZERTY en France et en Belgique, QWERTZ en Allemagne, Autriche
 * et Suisse, QWERTY ailleurs (Québec compris). Seules les lettres qui changent sont listées.
 */
export function guessLayout(languages: readonly string[]): Map<string, string> {
  const language = (languages[0] ?? '').toLowerCase();
  if (/^fr(-(fr|be|lu|mc))?$/.test(language)) {
    return new Map([
      ['KeyQ', 'a'],
      ['KeyW', 'z'],
      ['KeyA', 'q'],
      ['KeyZ', 'w'],
      ['Semicolon', 'm'],
      ['KeyM', ','],
    ]);
  }
  if (/^de\b|^(fr|it)-ch$/.test(language)) {
    return new Map([
      ['KeyY', 'z'],
      ['KeyZ', 'y'],
    ]);
  }
  return new Map();
}
