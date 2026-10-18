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
 * Menu d'achat, en fenêtre comme le menu principal. On achète au clavier (touches 1 à 0) : la souris
 * reste capturée par le jeu, qui continue pendant qu'on achète, comme dans CS.
 */
export class BuyMenu {
  private readonly element = document.getElementById('buy-menu')!;
  private lastHtml = '';
  open = false;
  /** Dernier message (« Pas assez d'argent »…). */
  message = '';

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
        `<div class="buy-card ${item.state}"><span class="key">${item.key}</span>` +
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
      `<span class="hint">Touches <kbd>1</kbd> à <kbd>0</kbd> pour acheter</span></footer></div>`;
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    this.element.innerHTML = html;
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.message = '';
    this.lastHtml = '';
    this.element.classList.toggle('hidden', !open);
  }
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
