import {
  isFieldEnabled,
  SETTINGS_TABS,
  type SettingField,
  type Settings,
} from '../core/settings';
import {
  ACTIONS,
  BINDING_SLOTS,
  keyName,
  RESERVED_CODES,
  type Action,
} from '../core/bindings';
import { fillCrosshair, styleCrosshair } from './crosshair';

/**
 * Corps du menu, construit à partir de SETTINGS_TABS : les rubriques à gauche (une par
 * catégorie, plus « Touches » pour changer les touches de chaque action, et les pages
 * données par le jeu, comme « En ligne »), leurs options à droite. Chaque changement
 * est appliqué tout de suite.
 */
export class SettingsPanel {
  private readonly refreshers: (() => void)[] = [];
  /** Carte du clavier (lettres selon la disposition : Z au lieu de W en AZERTY). */
  private layout: Map<string, string> | undefined;
  /** Case en attente d'une touche, et de quoi arrêter l'écoute. */
  private listening: { stop: () => void } | null = null;

  constructor(
    container: HTMLElement,
    private readonly settings: Settings,
    private readonly onChange: (settings: Settings, key: keyof Settings) => void,
    /** Pages ajoutées par le jeu, insérées à la position `index` parmi les rubriques. */
    extraPages: { title: string; element: HTMLElement; index: number }[] = [],
  ) {
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    const pages = document.createElement('div');
    pages.className = 'tab-pages';

    const extra = { title: 'Touches', element: this.buildBindingsPage() };
    const allTabs = [
      ...SETTINGS_TABS.map((tab) => ({ title: tab.title, element: this.buildPage(tab.fields) })),
      extra,
    ];
    for (const page of extraPages) allTabs.splice(page.index, 0, { title: page.title, element: page.element });

    allTabs.forEach(({ title, element }, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab';
      button.textContent = title;
      button.addEventListener('click', () => select(i));
      tabs.append(button);
      element.classList.add('tab-page');
      pages.append(element);
    });
    const select = (index: number) => {
      tabs.querySelectorAll('.tab').forEach((tab, i) => tab.classList.toggle('active', i === index));
      pages.querySelectorAll<HTMLElement>('.tab-page').forEach((page, i) => (page.hidden = i !== index));
    };
    select(0);

    const content = document.createElement('div');
    content.className = 'menu-content';
    content.append(pages);
    container.replaceChildren(tabs, content);
    this.refresh();
  }

  /**
   * Onglet « Touches » : deux cases par action. On clique sur une case puis on
   * appuie sur une touche, un bouton de souris ou la molette ; Échap annule,
   * Retour arrière ou Suppr vide la case. Une touche déjà prise est retirée de
   * l'action qui l'avait.
   */
  private buildBindingsPage(): HTMLElement {
    const page = document.createElement('div');
    for (const { action, label } of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'setting binding';
      const name = document.createElement('span');
      name.className = 'label';
      name.textContent = label;
      const control = document.createElement('div');
      control.className = 'control';
      for (let slot = 0; slot < BINDING_SLOTS; slot++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'option key';
        button.addEventListener('click', () => this.listen(action, slot, button));
        control.append(button);
        this.refreshers.push(() => {
          const code = this.settings.bindings[action][slot];
          button.textContent = code ? keyName(code, this.layout) : '—';
          button.classList.remove('listening');
        });
      }
      row.append(name, control);
      page.append(row);
    }
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Échap : pause (non modifiable). Clique sur une case puis appuie sur la touche voulue ; Échap annule, Retour arrière vide la case.';
    page.append(note);

    // Lettres selon la disposition du clavier : le navigateur la donne (Chrome, Edge) ;
    // sinon (Firefox), on apprend la lettre de chaque touche dès qu'elle est utilisée.
    this.layout = loadLearnedKeys();
    window.addEventListener('keydown', (event) => {
      if (event.key.length !== 1 || this.layout?.get(event.code) === event.key) return;
      this.layout ??= new Map();
      this.layout.set(event.code, event.key);
      saveLearnedKeys(this.layout);
      this.refresh();
    });
    const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
    keyboard
      ?.getLayoutMap()
      .then((layout) => {
        this.layout = new Map([...(this.layout ?? []), ...layout]);
        this.refresh();
      })
      .catch(() => {});
    return page;
  }

  private listen(action: Action, slot: number, button: HTMLButtonElement): void {
    this.stopListening();
    button.textContent = 'Appuie sur une touche…';
    button.classList.add('listening');

    const finish = (code: string | null | undefined) => {
      this.stopListening();
      if (code !== undefined) this.assign(action, slot, code);
      this.refresh();
    };
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') finish(undefined);
      else if (event.code === 'Backspace' || event.code === 'Delete') finish(null);
      else if (!RESERVED_CODES.includes(event.code)) finish(event.code);
    };
    const onMouse = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      finish(`Mouse${event.button}`);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      finish('Wheel');
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    this.listening = {
      stop: () => {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('mousedown', onMouse, true);
        window.removeEventListener('wheel', onWheel, true);
      },
    };
  }

  private stopListening(): void {
    this.listening?.stop();
    this.listening = null;
  }

  /** Met `code` dans la case (null = vider), en le retirant de toute autre action. */
  private assign(action: Action, slot: number, code: string | null): void {
    const bindings = this.settings.bindings;
    if (code) {
      for (const { action: other } of ACTIONS) bindings[other] = bindings[other].filter((c) => c !== code);
    }
    const codes = [...bindings[action]];
    if (code) codes[slot] = code;
    else codes.splice(slot, 1);
    bindings[action] = codes.filter((c) => typeof c === 'string').slice(0, BINDING_SLOTS);
    this.onChange(this.settings, 'bindings');
  }

  private buildPage(fields: SettingField[]): HTMLElement {
    const page = document.createElement('div');
    for (const field of fields) page.append(this.buildRow(field));
    return page;
  }

  private buildRow(field: SettingField): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = field.label;
    const control = document.createElement('div');
    control.className = 'control';
    row.append(label, control);

    const set = (value: unknown) => {
      (this.settings as Record<keyof Settings, unknown>)[field.key] = value;
      this.onChange(this.settings, field.key);
      this.refresh();
    };

    switch (field.type) {
      case 'toggle': {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'switch';
        button.addEventListener('click', () => set(!this.settings[field.key]));
        control.append(button);
        this.refreshers.push(() => {
          const on = this.settings[field.key] as boolean;
          button.textContent = on ? field.on : field.off;
          button.classList.toggle('on', on);
        });
        break;
      }
      case 'choice': {
        const buttons = field.options.map((option) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'option';
          button.textContent = option.label;
          if (option.swatch) button.prepend(Object.assign(document.createElement('span'), { className: 'swatch', style: `background:${option.swatch}` }));
          button.addEventListener('click', () => set(option.value));
          control.append(button);
          return { button, value: option.value };
        });
        this.refreshers.push(() => {
          for (const { button, value } of buttons) button.classList.toggle('active', this.settings[field.key] === value);
        });
        break;
      }
      case 'crosshair': {
        const preview = document.createElement('div');
        preview.className = 'crosshair-preview';
        preview.style.backgroundImage = `url(${import.meta.env.BASE_URL}maps/medina/preview.webp)`;
        const crosshair = document.createElement('div');
        fillCrosshair(crosshair);
        preview.append(crosshair);
        control.append(preview);
        this.refreshers.push(() => styleCrosshair(crosshair, this.settings.crosshairColor, this.settings.crosshairSize));
        break;
      }
      case 'cards': {
        // Une rangée à part, sur toute la largeur : une grande carte par choix, avec son image.
        row.classList.add('cards-row');
        control.classList.add('cards');
        const cards = field.options.map((option) => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'card';
          const image = document.createElement('img');
          image.src = `${import.meta.env.BASE_URL}${option.image}`;
          image.alt = '';
          image.loading = 'lazy';
          const name = document.createElement('span');
          name.className = 'card-name';
          name.textContent = option.label;
          const description = document.createElement('span');
          description.className = 'card-description';
          description.textContent = option.description;
          const badge = document.createElement('span');
          badge.className = 'card-badge';
          badge.textContent = 'Sélectionnée';
          card.append(image, badge, name, description);
          card.addEventListener('click', () => {
            if (this.settings[field.key] !== option.value) set(option.value);
          });
          control.append(card);
          return { card, value: option.value };
        });
        if (field.hint) {
          const hint = document.createElement('p');
          hint.className = 'cards-hint';
          hint.textContent = field.hint;
          row.append(hint);
        }
        this.refreshers.push(() => {
          for (const { card, value } of cards) card.classList.toggle('active', this.settings[field.key] === value);
        });
        break;
      }
      case 'range': {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(field.min);
        slider.max = String(field.max);
        slider.step = String(field.step);
        const value = document.createElement('span');
        value.className = 'value';
        const decimals = field.step < 1 ? String(field.step).split('.')[1].length : 0;
        slider.addEventListener('input', () => set(Number(slider.value)));
        control.append(slider, value);
        this.refreshers.push(() => {
          const current = this.settings[field.key] as number;
          slider.value = String(current);
          value.textContent = field.format ? field.format(current) : `${current.toFixed(decimals)}${field.unit ?? ''}`;
        });
        break;
      }
    }

    // Réglage grisé quand il n'a pas de sens (ex. : difficulté sans bots).
    this.refreshers.push(() => {
      const enabled = isFieldEnabled(field.key, this.settings);
      row.classList.toggle('disabled', !enabled);
      control.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach((el) => (el.disabled = !enabled));
    });
    return row;
  }

  private refresh(): void {
    for (const refresh of this.refreshers) refresh();
  }
}

const LEARNED_KEYS = 'fps1.keyLabels';

function loadLearnedKeys(): Map<string, string> | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(LEARNED_KEYS) ?? 'null');
    return stored && typeof stored === 'object' ? new Map(Object.entries(stored as Record<string, string>)) : undefined;
  } catch {
    return undefined;
  }
}

function saveLearnedKeys(layout: Map<string, string>): void {
  try {
    localStorage.setItem(LEARNED_KEYS, JSON.stringify(Object.fromEntries(layout)));
  } catch {
    // Stockage bloqué : on réapprendra à la prochaine partie.
  }
}
