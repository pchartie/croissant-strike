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
  | 'grenades';

/** Codes de touches : ceux du clavier (`KeyW`…), `Mouse0` à `Mouse4` et `Wheel` pour la molette. */
export type Bindings = Record<Action, string[]>;

/** Nombre de touches par action. */
export const BINDING_SLOTS = 2;

export const ACTIONS: { action: Action; label: string }[] = [
  { action: 'forward', label: 'Avancer' },
  { action: 'back', label: 'Reculer' },
  { action: 'left', label: 'Aller à gauche' },
  { action: 'right', label: 'Aller à droite' },
  { action: 'jump', label: 'Sauter' },
  { action: 'crouch', label: "S'accroupir" },
  { action: 'walk', label: 'Marcher lentement' },
  { action: 'attack', label: 'Tirer / lancer loin / coup rapide' },
  { action: 'attack2', label: 'Lancer en cloche / coup puissant' },
  { action: 'reload', label: 'Recharger' },
  { action: 'weapon1', label: 'Fusil' },
  { action: 'weapon2', label: 'Pistolet' },
  { action: 'weapon3', label: 'Couteau' },
  { action: 'grenades', label: 'Grenades (appuyer à nouveau pour changer)' },
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
