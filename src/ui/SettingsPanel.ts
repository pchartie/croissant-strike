import {
  DEFAULT_SETTINGS,
  isFieldEnabled,
  SETTINGS_TABS,
  type SettingField,
  type Settings,
} from '../core/settings';

/**
 * Panneau de réglages du menu de pause, construit à partir de SETTINGS_TABS :
 * un onglet par catégorie, plus un onglet « Touches » avec le récapitulatif
 * des commandes. Chaque changement est appliqué tout de suite.
 */
export class SettingsPanel {
  private readonly refreshers: (() => void)[] = [];

  constructor(
    container: HTMLElement,
    private readonly settings: Settings,
    private readonly onChange: (settings: Settings, key: keyof Settings) => void,
  ) {
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    const pages = document.createElement('div');
    pages.className = 'tab-pages';

    const extra = { title: 'Touches', element: document.getElementById('controls')! };
    const allTabs = [
      ...SETTINGS_TABS.map((tab) => ({ title: tab.title, element: this.buildPage(tab.fields) })),
      extra,
    ];

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

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reset';
    reset.textContent = 'Réglages par défaut';
    reset.addEventListener('click', () => {
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        if (this.settings[key] === DEFAULT_SETTINGS[key]) continue;
        (this.settings as Record<keyof Settings, unknown>)[key] = DEFAULT_SETTINGS[key];
        this.onChange(this.settings, key);
      }
      this.refresh();
    });

    container.replaceChildren(tabs, pages, reset);
    this.refresh();
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
          button.addEventListener('click', () => set(option.value));
          control.append(button);
          return { button, value: option.value };
        });
        this.refreshers.push(() => {
          for (const { button, value } of buttons) button.classList.toggle('active', this.settings[field.key] === value);
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
          value.textContent = `${current.toFixed(decimals)}${field.unit ?? ''}`;
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
