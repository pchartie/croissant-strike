// Les codes physiques (KeyW, KeyA…) suivent la position des touches : sur un
// clavier AZERTY, KeyW est la touche Z, KeyA la touche Q.
export class Input {
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

    // La molette sert aussi à sauter, comme le font beaucoup de joueurs de CS.
    document.addEventListener('wheel', (e) => {
      if (this.locked && e.deltaY !== 0) this.pressed.add('Space');
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

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** Vrai une seule fois par appui. */
  consumePress(code: string): boolean {
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
