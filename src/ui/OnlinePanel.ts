import type { Online, OnlineStatus } from '../net/Online';

const NAME_KEY = 'fps1.name';

/**
 * Encart « En ligne » du menu : pseudo, créer une partie (on reçoit un code à
 * donner à l'adversaire) ou en rejoindre une avec son code.
 */
export class OnlinePanel {
  private readonly name: HTMLInputElement;
  private readonly code: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly idle: HTMLElement;
  private readonly busy: HTMLElement;
  private readonly leave: HTMLButtonElement;

  constructor(container: HTMLElement, online: Online) {
    container.innerHTML = `
      <h2>En ligne · 1 contre 1</h2>
      <label class="online-name">Pseudo <input type="text" maxlength="16" placeholder="Ton pseudo" /></label>
      <div class="online-idle">
        <button type="button" class="online-host">Créer une partie</button>
        <span class="online-or">ou</span>
        <input type="text" class="online-code" maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false" />
        <button type="button" class="online-join">Rejoindre</button>
      </div>
      <div class="online-busy"><button type="button" class="online-leave"></button></div>
      <p class="online-status"></p>`;
    const $ = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
    this.name = $<HTMLInputElement>('.online-name input');
    this.code = $<HTMLInputElement>('.online-code');
    this.status = $('.online-status');
    this.idle = $('.online-idle');
    this.busy = $('.online-busy');
    this.leave = $<HTMLButtonElement>('.online-leave');

    this.name.value = loadName();
    this.name.addEventListener('change', () => saveName(this.name.value));
    $('.online-host').addEventListener('click', () => void online.host(this.playerName));
    $('.online-join').addEventListener('click', () => void online.join(this.code.value, this.playerName));
    this.code.addEventListener('keydown', (event) => {
      // Les touches tapées ici ne doivent pas faire bouger le joueur.
      event.stopPropagation();
      if (event.key === 'Enter') void online.join(this.code.value, this.playerName);
    });
    this.name.addEventListener('keydown', (event) => event.stopPropagation());
    this.leave.addEventListener('click', () => online.leave());
    online.onStatus((status) => this.render(status));
    this.render(online.status);
  }

  get playerName(): string {
    return this.name.value.trim() || 'Joueur';
  }

  private render(status: OnlineStatus): void {
    const busy = status.kind === 'hosting' || status.kind === 'joining' || status.kind === 'connected';
    this.idle.hidden = busy;
    this.busy.hidden = !busy;
    this.name.disabled = busy;
    this.leave.textContent = status.kind === 'connected' ? 'Quitter la partie' : 'Annuler';
    this.status.classList.toggle('error', status.kind === 'error');
    switch (status.kind) {
      case 'idle':
        this.status.textContent = 'Crée une partie et donne le code à ton adversaire, ou entre le sien.';
        break;
      case 'hosting':
        this.status.innerHTML = `Code de la partie : <strong class="online-code-value">${status.code}</strong> — en attente de l'adversaire…`;
        break;
      case 'joining':
        this.status.textContent = `Connexion à la partie ${status.code}…`;
        break;
      case 'connected':
        this.status.textContent = `Connecté à ${status.opponent} (partie ${status.code}). Clique sur Jouer !`;
        break;
      case 'error':
        this.status.textContent = status.message;
        break;
    }
  }
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    // Stockage bloqué : le pseudo sera à retaper la prochaine fois.
  }
}
