export interface BuyMenuItem {
  key: string;
  label: string;
  price: number;
  /** ok : achetable ; expensive : pas assez d'argent ; owned : déjà possédé ou limite atteinte. */
  state: 'ok' | 'expensive' | 'owned';
  /** Rubrique du menu. */
  group: BuyGroup;
  /** Silhouette de l'article. */
  icon?: string | null;
}

export type BuyGroup = 'weapon' | 'gear' | 'grenade';

const GROUPS: { group: BuyGroup; title: string }[] = [
  { group: 'weapon', title: 'Armes principales' },
  { group: 'gear', title: 'Équipement' },
  { group: 'grenade', title: 'Grenades' },
];

/**
 * Menu d'achat, en fenêtre comme le menu principal. On achète au clavier (touches 1 à 0) ou à la
 * souris. Le jeu garde la souris capturée (la relâcher mettrait la partie en pause, et le navigateur
 * ne la rend qu'après un clic) : le menu dessine son propre curseur, déplacé par la souris.
 */
export class BuyMenu {
  private readonly element = document.getElementById('buy-menu')!;
  private readonly content = document.createElement('div');
  private readonly cursor = document.createElement('div');
  private cursorX = 0;
  private cursorY = 0;
  private hovered: HTMLElement | null = null;
  private lastHtml = '';
  open = false;
  /** Dernier message (« Pas assez d'argent »…). */
  message = '';

  constructor() {
    this.cursor.className = 'buy-cursor';
    this.element.append(this.content, this.cursor);
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  close(): void {
    this.setOpen(false);
  }

  render(items: BuyMenuItem[], money: number | null, timeLeft: number | null): void {
    if (!this.open) return;
    const card = (item: BuyMenuItem) => {
      const price = money === null ? 'Gratuit' : `${item.price.toLocaleString('fr-FR')} $`;
      const icon = item.icon ? `<img src="${item.icon}" alt="">` : '';
      const status = item.state === 'owned' ? '<span class="status">Équipé</span>' : item.state === 'expensive' ? '<span class="status">Trop cher</span>' : '';
      return (
        `<div class="buy-card ${item.state}" data-key="${item.key}"><span class="key">${item.key}</span>` +
        `<span class="thumb">${icon}</span><span class="name">${escape(item.label)}</span>` +
        `<span class="price">${price}</span>${status}</div>`
      );
    };
    const section = ({ group, title }: (typeof GROUPS)[number]) =>
      `<section class="buy-group ${group}"><h3>${title}</h3><div class="buy-grid">${items.filter((item) => item.group === group).map(card).join('')}</div></section>`;
    const wallet = money === null ? 'Deathmatch : tout est gratuit' : `<b>${money.toLocaleString('fr-FR')} $</b>`;
    const time = timeLeft === null ? '' : `<span class="buy-time">Encore ${Math.ceil(timeLeft)} s pour acheter</span>`;
    const html =
      `<div class="buy-panel"><header class="buy-header"><h2>Achat</h2><span class="buy-wallet">${wallet}</span>${time}</header>` +
      `${section(GROUPS[0])}<div class="buy-columns">${section(GROUPS[1])}${section(GROUPS[2])}</div>` +
      `<footer class="buy-footer"><span class="message">${escape(this.message)}</span>` +
      `<span class="hint">Clic ou touches <kbd>1</kbd> à <kbd>0</kbd> pour acheter</span></footer></div>`;
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    this.content.innerHTML = html;
    this.hover();
  }

  /** La souris bouge (déplacement capturé, en pixels) : le curseur suit, sans sortir de l'écran. */
  moveCursor(dx: number, dy: number): void {
    if (!this.open || (dx === 0 && dy === 0)) return;
    this.cursorX = Math.min(window.innerWidth - 1, Math.max(0, this.cursorX + dx));
    this.cursorY = Math.min(window.innerHeight - 1, Math.max(0, this.cursorY + dy));
    this.cursor.style.transform = `translate(${this.cursorX}px, ${this.cursorY}px)`;
    this.hover();
  }

  /**
   * Clic : renvoie la touche de l'article sous le curseur (à acheter), ou null. Un clic hors de la
   * fenêtre la ferme.
   */
  click(): string | null {
    if (!this.open) return null;
    const target = document.elementFromPoint(this.cursorX, this.cursorY);
    const card = target?.closest<HTMLElement>('.buy-card');
    if (card) return card.dataset.key ?? null;
    if (!target?.closest('.buy-panel')) this.close();
    return null;
  }

  /** Surligne la carte sous le curseur. */
  private hover(): void {
    const card = document.elementFromPoint(this.cursorX, this.cursorY)?.closest<HTMLElement>('.buy-card') ?? null;
    if (card === this.hovered) return;
    this.hovered?.classList.remove('hover');
    card?.classList.add('hover');
    this.hovered = card;
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.message = '';
    this.lastHtml = '';
    this.hovered = null;
    this.element.classList.toggle('hidden', !open);
    // Le curseur part du centre de l'écran, là où était le réticule.
    this.cursorX = window.innerWidth / 2;
    this.cursorY = window.innerHeight / 2;
    this.cursor.style.transform = `translate(${this.cursorX}px, ${this.cursorY}px)`;
  }
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
