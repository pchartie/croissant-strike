export interface BuyMenuItem {
  key: string;
  label: string;
  price: number;
  /** ok : achetable ; expensive : pas assez d'argent ; owned : déjà possédé ou limite atteinte. */
  state: 'ok' | 'expensive' | 'owned';
}

/**
 * Menu d'achat au clavier, comme dans CS 1.6 : la souris reste capturée par le
 * jeu, on achète avec les touches 1 à 0.
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
    const rows = items
      .map((item) => {
        const price = money === null ? 'gratuit' : `${item.price} $`;
        return `<div class="item ${item.state}"><span class="key">${item.key}</span><span class="name">${escape(item.label)}</span><span>${price}</span></div>`;
      })
      .join('');
    const footer = [
      money === null ? 'Deathmatch : tout est gratuit' : `Argent : ${money} $`,
      timeLeft === null ? '' : `encore ${Math.ceil(timeLeft)} s pour acheter`,
    ]
      .filter(Boolean)
      .join(' · ');
    const html = `<h2>ACHAT</h2>${rows}<div class="footer">${footer} · B pour fermer</div><div class="message">${escape(this.message)}</div>`;
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
