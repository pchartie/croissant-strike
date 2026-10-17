import type { CrosshairColor, CrosshairSize } from '../core/settings';

// Réticule façon CS (4 traits autour du centre), partagé entre le jeu et l'aperçu du menu.

export const CROSSHAIR_COLORS: Record<CrosshairColor, string> = {
  green: '#4dff4d',
  white: '#ffffff',
  red: '#ff4d4d',
  cyan: '#4df6ff',
  yellow: '#ffe94d',
};

const CROSSHAIR_SIZES: Record<CrosshairSize, { len: number; gap: number; thick: number }> = {
  small: { len: 5, gap: 3, thick: 2 },
  medium: { len: 7, gap: 5, thick: 2 },
  large: { len: 11, gap: 7, thick: 3 },
};

/** Les 4 traits du réticule, à placer dans un élément de classe `crosshair`. */
export function fillCrosshair(element: HTMLElement): void {
  element.classList.add('crosshair');
  element.replaceChildren(
    ...['top', 'bottom', 'left', 'right'].map((side) => Object.assign(document.createElement('span'), { className: side })),
  );
}

/** Couleur et taille du réticule. */
export function styleCrosshair(element: HTMLElement, color: CrosshairColor, size: CrosshairSize): void {
  const { len, gap, thick } = CROSSHAIR_SIZES[size];
  const style = element.style;
  style.setProperty('--color', CROSSHAIR_COLORS[color]);
  style.setProperty('--len', `${len}px`);
  style.setProperty('--gap', `${gap}px`);
  style.setProperty('--thick', `${thick}px`);
}
