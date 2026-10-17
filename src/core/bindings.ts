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
  | 'buy'
  | 'scoreboard';

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
  { action: 'crouch', label: "S'accroupir", group: 'Déplacements' },
  { action: 'walk', label: 'Marcher', hint: 'sans bruit', group: 'Déplacements' },
  { action: 'attack', label: 'Tirer', hint: 'grenade lancée loin · coup de couteau rapide', group: 'Combat' },
  { action: 'attack2', label: 'Action secondaire', hint: 'grenade en cloche · coup de couteau puissant', group: 'Combat' },
  { action: 'reload', label: 'Recharger', group: 'Combat' },
  { action: 'weapon1', label: 'Arme principale', group: 'Équipement' },
  { action: 'weapon2', label: 'Pistolet', group: 'Équipement' },
  { action: 'weapon3', label: 'Couteau', group: 'Équipement' },
  { action: 'grenades', label: 'Grenades', hint: 'appuyer à nouveau pour changer', group: 'Équipement' },
  { action: 'buy', label: "Menu d'achat", group: 'Interface' },
  { action: 'scoreboard', label: 'Tableau des scores', hint: 'maintenir', group: 'Interface' },
];

// Codes physiques : sur un clavier AZERTY, KeyW est la touche Z et KeyA la touche Q.
export const DEFAULT_BINDINGS: Bindings = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space', 'Wheel'],
  // Ctrl+W ferme l'onglet du navigateur en QWERTY : C est proposé en plus.
  crouch: ['ControlLeft', 'KeyC'],
  walk: ['ShiftLeft'],
  attack: ['Mouse0'],
  attack2: ['Mouse2'],
  reload: ['KeyR'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  grenades: ['Digit4'],
  buy: ['KeyB'],
  scoreboard: ['Tab'],
};

/** Touches qu'on ne peut pas assigner : Échap met le jeu en pause. */
export const RESERVED_CODES = ['Escape'];

/** Garde les touches valides d'une sauvegarde ; les actions absentes reprennent leurs touches par défaut. */
export function validateBindings(value: unknown): Bindings {
  const bindings = cloneBindings(DEFAULT_BINDINGS);
  if (!value || typeof value !== 'object') return bindings;
  for (const { action } of ACTIONS) {
    const codes = (value as Record<string, unknown>)[action];
    if (!Array.isArray(codes)) continue;
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
  Wheel: 'Molette',
};

/**
 * Nom lisible d'une touche. `layout` (carte du clavier fournie par le navigateur)
 * donne la vraie lettre selon la disposition : KeyW s'affiche « Z » en AZERTY.
 */
export function keyName(code: string, layout?: Map<string, string>): string {
  if (NAMES[code]) return NAMES[code];
  const letter = layout?.get(code);
  if (letter && letter.trim()) return letter.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Pavé ${code.slice(6)}`;
  return code;
}
