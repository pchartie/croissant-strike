// Icônes blanches du HUD (vie, gilet, éliminations, headshot, couteau…), dessinées en SVG ici :
// rien à charger, et elles restent nettes à toutes les tailles. Même style que les silhouettes d'armes.

const svg = (width: number, body: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 48" fill="#fff">${body}</svg>`)}`;

export const HUD_ICONS = {
  /** Croix de soin. */
  health: svg(48, `<path d="M18 4h12v14h14v12H30v14H18V30H4V18h14z"/>`),
  /** Écusson du gilet pare-balles. */
  armor: svg(48, `<path d="M24 3l18 6v13c0 12-8 20-18 24C14 42 6 34 6 22V9z"/><path d="M24 10l11 4v8c0 8-5 13-11 16z" fill="#000" opacity=".3"/>`),
  /** Gilet et casque. */
  helmet: svg(48, `<path d="M4 32c0-15 9-25 21-25s21 10 21 25v3H4z"/><rect x="1" y="34" width="46" height="6" rx="2"/><path d="M25 11c7 1 13 7 14 17H25z" fill="#000" opacity=".3"/>`),
  /** Éliminations : un viseur. */
  kills: svg(48, `<g fill="none" stroke="#fff" stroke-width="4"><circle cx="24" cy="24" r="14"/><path d="M24 2v12M24 34v12M2 24h12M34 24h12"/></g><circle cx="24" cy="24" r="3"/>`),
  /** Morts : un crâne. */
  deaths: svg(48, `<path d="M24 3C13 3 6 10 6 20c0 6 3 10 7 12v8h22v-8c4-2 7-6 7-12C42 10 35 3 24 3z"/><g fill="#000"><circle cx="16.5" cy="21" r="5"/><circle cx="31.5" cy="21" r="5"/><path d="M24 26l3 6h-6z"/><rect x="18" y="38" width="3" height="5"/><rect x="27" y="38" width="3" height="5"/></g><rect x="13" y="42" width="22" height="3"/>`),
  /** Headshot : une tête trouée, comme dans le fil de CS. */
  headshot: svg(48, `<path d="M25 4c-10 0-17 7-17 16 0 4 1 7 3 9v15h18v-6h5c2 0 3-1 3-3v-5l4-2-3-6c0-11-5-18-13-18z"/><circle cx="22" cy="17" r="5" fill="#000"/><g stroke="#fff" stroke-width="3"><path d="M22 4v6M22 24v6M9 17h6M29 17h6"/></g>`),
  /** Couteau (lame vers la droite). */
  knife: svg(96, `<path d="M4 20h30l3-3h4v14h-4l-3-3H4c-2 0-3-1-3-4s1-4 3-4z"/><rect x="41" y="15" width="5" height="18" rx="1"/><path d="M46 19h28c10 0 17 3 21 9-6 3-14 4-22 4H46z"/><path d="M48 26h30" stroke="#000" stroke-width="2" opacity=".35"/>`),
  /** Dans le dos : une flèche qui contourne. */
  backstab: svg(48, `<path d="M8 30c0-12 9-20 22-20h4V3l12 12-12 12v-8h-4c-8 0-13 4-13 11v9H8z"/>`),
};
