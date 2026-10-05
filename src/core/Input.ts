import { DEFAULT_BINDINGS, type Action, type Bindings } from './bindings';

/**
 * Clavier et souris. Le jeu demande des actions (« avancer », « tirer »…), que
 * les réglages associent à des touches. Les codes physiques (KeyW…) suivent la
 * position des touches : sur un clavier AZERTY, KeyW est la touche Z.
 */
export class Input {
  private bindings: Bindings = DEFAULT_BINDINGS;
  private held = new Set<string>();
  private pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private lockListeners: ((locked: boolean) => void)[] = [];

  locked = false;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    // Boutons de la souris : Mouse0 = gauche, Mouse2 = droit.
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.pressed.add(`Mouse${e.button}`);
      this.held.add(`Mouse${e.button}`);
    });
    document.addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    // La molette compte comme une touche « Wheel » qu'on appuie (pour sauter, par défaut).
    document.addEventListener('wheel', (e) => {
      if (this.locked && e.deltaY !== 0) this.pressed.add('Wheel');
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this.held.clear();
        this.pressed.clear();
      }
      for (const listener of this.lockListeners) listener(this.locked);
    });
  }

  requestLock(): void {
    // Le navigateur refuse si on reverrouille juste après Échap : on ignore.
    Promise.resolve(this.element.requestPointerLock()).catch(() => {});
  }

  onLockChange(listener: (locked: boolean) => void): void {
    this.lockListeners.push(listener);
  }

  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
  }

  /** Vrai tant qu'une des touches de l'action est enfoncée. */
  isDown(action: Action): boolean {
    return this.bindings[action].some((code) => this.held.has(code));
  }

  /** Vrai une seule fois par appui sur une des touches de l'action. */
  consumePress(action: Action): boolean {
    let pressed = false;
    for (const code of this.bindings[action]) if (this.pressed.delete(code)) pressed = true;
    return pressed;
  }

  /** Vrai une seule fois par appui sur cette touche précise (menu d'achat : touches 1 à 0). */
  consumeCode(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** Oublie les appuis non utilisés pendant ce tick (sauter en l'air, recharger plein…). */
  endTick(): void {
    this.pressed.clear();
  }

  consumeMouse(): { dx: number; dy: number } {
    const delta = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }
}
