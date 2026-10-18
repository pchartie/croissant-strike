import type { GrenadeType } from '../grenades/definitions';

// Silhouettes blanches du menu d'achat pour ce qui n'a pas d'icône dans le pack d'armes : gilet, casque et
// grenades (même style que les armes, voir weaponIcons.ts). Dessinées ici en SVG, sans fichier à charger.

const svg = (width: number, body: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 48" fill="#fff">${body}</svg>`)}`;

/** Gilet pare-balles : épaules, encolure, deux poches. */
const VEST = `<path d="M14 4h7l3 6h8l3-6h7l4 8v32H10V12z"/><rect x="15" y="26" width="9" height="10" fill="#000" opacity=".35"/><rect x="32" y="26" width="9" height="10" fill="#000" opacity=".35"/>`;
/** Casque à visière basse. */
const HELMET = (x: number) => `<path d="M${x} 30c0-14 9-22 20-22s20 8 20 22v4H${x}z"/><rect x="${x - 3}" y="33" width="46" height="5" rx="2"/>`;

const ICONS = {
  armor: svg(56, VEST),
  helmet: svg(108, VEST + HELMET(62)),
  he: svg(44, `<circle cx="20" cy="29" r="15"/><rect x="15" y="8" width="10" height="8" rx="2"/><path d="M25 10h12l-2 18-4-1 2-13h-8z"/><circle cx="13" cy="10" r="5" fill="none" stroke="#fff" stroke-width="3"/>`),
  flash: svg(32, `<rect x="6" y="14" width="20" height="32" rx="3"/><rect x="10" y="6" width="12" height="9" rx="2"/><path d="M22 8h8l-1 16-3-1v-12h-4z"/><rect x="6" y="22" width="20" height="3" fill="#000" opacity=".35"/>`),
  smoke: svg(32, `<rect x="5" y="12" width="22" height="34" rx="3"/><rect x="10" y="4" width="12" height="9" rx="2"/><path d="M22 6h8l-1 16-3-1v-12h-4z"/><g fill="#000" opacity=".4"><circle cx="11" cy="22" r="2"/><circle cx="21" cy="22" r="2"/><circle cx="11" cy="38" r="2"/><circle cx="21" cy="38" r="2"/></g>`),
  molotov: svg(36, `<path d="M10 46V24c0-5 4-7 4-11V9h8v4c0 4 4 6 4 11v22z"/><rect x="13" y="4" width="10" height="6" rx="1"/><path d="M18 4c-4-3-2-6 0-8 1 3 5 4 3 8z"/><rect x="10" y="30" width="16" height="7" fill="#000" opacity=".35"/>`),
  // Baril (fil des éliminations) : fût cerclé, flamme au-dessus.
  barrel: svg(40, `<rect x="8" y="18" width="24" height="28" rx="3"/><g fill="#000" opacity=".35"><rect x="8" y="24" width="24" height="3"/><rect x="8" y="37" width="24" height="3"/></g><path d="M20 2c3 5 9 8 6 15h-12c-3-6 2-9 3-13 1 3 2 4 3 5z"/>`),
} satisfies Record<'armor' | 'helmet' | 'barrel' | GrenadeType, string>;

export function shopIcon(kind: 'armor' | 'helmet' | 'barrel' | GrenadeType): string {
  return ICONS[kind];
}
